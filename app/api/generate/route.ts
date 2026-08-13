// app/api/generate/route.ts
import { NextResponse } from "next/server";
import { OutputSchema } from "@/lib/schema";
import { prisma } from "@/lib/prisma";
import { makeMockOutput, mockStreamingJson } from "@/lib/mockOpenAI";
import {
  extractDocxBuffer,
  extractFirstUrl,
  extractPdfBuffer,
  fetchTextFromUrl,
  FetchBlockedError,
} from "@/lib/sourceFetcher";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
const useMock = process.env.MOCK_OPENAI === "true";

const openaiClient = useMock
  ? null
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropicClient = useMock
  ? null
  : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type Provider = "openai" | "claude";

// Field order matters here: under a large combined generation (long resume
// text + several other fields in one tool call), Claude has been observed to
// occasionally drop whichever field comes last. Putting the small structured
// fields before the big free-text "tailoredResume" field measurably reduces
// (but doesn't eliminate) that — see the retry loop in callModel for the rest.
const RESUME_TOOL = {
  name: "return_tailored_resume",
  description: "Return the tailored resume result as structured data.",
  input_schema: {
    type: "object" as const,
    properties: {
      company: { type: "string" },
      roleTitle: { type: "string" },
      interviewQuestions: {
        type: "array",
        items: { type: "string" },
        minItems: 8,
        maxItems: 12,
      },
      adaptationNotes: { type: "string" },
      tailoredResume: { type: "string" },
    },
    required: [
      "company",
      "roleTitle",
      "interviewQuestions",
      "adaptationNotes",
      "tailoredResume",
    ],
  },
};

async function callClaudeOnce(prompt: string) {
  if (!anthropicClient) {
    throw new Error("Anthropic client not initialized");
  }
  const msg = await anthropicClient.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8192,
    tools: [RESUME_TOOL],
    tool_choice: { type: "tool", name: RESUME_TOOL.name },
    messages: [{ role: "user", content: prompt }],
  });
  const toolUse = msg.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Claude did not return a structured result");
  }
  return OutputSchema.parse(toolUse.input);
}

async function callOpenAiOnce(prompt: string) {
  if (!openaiClient) {
    throw new Error("OpenAI client not initialized");
  }
  const resp = await openaiClient.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: "You return strict JSON only." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });
  const text = resp.choices[0]?.message?.content ?? "";
  return OutputSchema.parse(JSON.parse(text));
}

// A 401/403 from either SDK means the API key is missing/invalid — retrying
// the identical request 3x just triples the latency before an identical
// failure. Everything else (a transient 5xx, a rate limit, or our own
// OutputSchema/ZodError from the model omitting a field) is worth retrying.
function isFatalError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError || err instanceof Anthropic.APIError) {
    return err.status === 401 || err.status === 403;
  }
  return false;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// LLM structured-output calls occasionally omit or mis-type a field even
// with a schema/tool forcing the shape (observed with Claude on this prompt
// specifically, dropping whichever field lands last in a large combined
// generation). Retrying a failed attempt is standard practice here and is
// far cheaper than the alternative of splitting into multiple API calls.
// Backs off between attempts (500ms, 1000ms) rather than hammering
// immediately, in case the failure was a rate limit.
async function callModel(provider: Provider, prompt: string) {
  const attempts = 3;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return provider === "claude"
        ? await callClaudeOnce(prompt)
        : await callOpenAiOnce(prompt);
    } catch (err) {
      lastError = err;
      if (isFatalError(err)) throw err;
      if (i < attempts - 1) await delay(500 * 2 ** i);
    }
  }
  throw lastError;
}

function buildPrompt(
  jobDesc: string,
  experience: string,
  specialInstructions: string,
  provider: Provider,
) {
  const specialInstructionsBlock = specialInstructions
    ? `\nCANDIDATE-DIRECTED INSTRUCTIONS (highest priority — apply every one of these; they override the general stylistic defaults below whenever they conflict, with the sole exception of the no-fabrication rule):\n"""\n${specialInstructions}\n"""\nThese are explicit, deliberate requests from the candidate about their own information — treat them as requirements, not suggestions. Cosmetic/presentation requests (e.g. use a nickname, swap a link, change emphasis, tone adjustments, reorder sections) are fine and should be followed exactly; do not use them as license to invent employers, titles, dates, or metrics that aren't in the source resume. Before finalizing "tailoredResume", re-read each instruction above and verify the output actually reflects it — if the source resume doesn't support one, note that in "adaptationNotes" instead of silently skipping it.\n`
    : "";

  return `You are an expert resume writer and career coach. Given a job description and a candidate's actual resume content, rewrite the resume tailored to this specific job.

Job description:
"""
${jobDesc}
"""

Candidate's actual resume content:
"""
${experience}
"""
${specialInstructionsBlock}
Rules:
- Only reorganize, rephrase, and emphasize content that is actually present in the candidate's resume above.
- Do NOT invent employers, job titles, dates, degrees, certifications, or metrics that are not present in the source resume.
- Reorder and emphasize the experience most relevant to the job description.
- Wherever the candidate's actual background genuinely supports it, use the SAME specific terms the job description uses for skills/tools/technologies (exact wording, not just a synonym) — e.g. if the JD says "Kubernetes" and the candidate has that experience, write "Kubernetes", not just "container orchestration". This is for ATS keyword matching; never add a term the candidate doesn't actually have experience with.

"tailoredResume" must be a clean, ATS-friendly resume targeting 550-750 words total (hard cap 800) — this is a strict budget, not a suggestion. If including everything would exceed it, cut the least JD-relevant bullets/roles/sections first (older roles and generic bullets before recent, high-relevance ones), formatted as follows:
- Header, as compactly as possible: the candidate's name alone on line 1 (if present in the source resume). Line 2: ALL contact details combined into ONE single line separated by " | " (email, phone, location, LinkedIn/GitHub/portfolio URLs) — never spread contact details across multiple lines. If the source resume also has a short professional headline/tagline row directly under the name (e.g. a row of role or specialty labels separated by "|"), it may go on one more line after contact; otherwise omit it — never invent one. That's it: name, then one contact line, then optionally one tagline line — nothing else before the first section heading.
- After the header, use this exact section order, each as a "## " markdown heading, including only sections that have real content from the source resume (skip any section the source resume has nothing for):
  1. "## Technical Skills" (or "## Skills") — keep this to 1-2 lines total, not one line per category. Write it as a single flowing line (or two at most): if grouping by category, separate categories with "; " in one continuous line rather than a line break per category (e.g. "Leadership: A, B, C; Cloud: D, E, F; Languages: G, H"). Do not put a blank line or line break between categories.
  2. "## Professional Summary" (or "## Summary") — the tailored summary paragraph.
  3. "## Professional Experience" (or "## Experience") — for each role, a "### " sub-heading line combining title, company, location, and date range (e.g. "### Job Title | Company, Location - Mon YYYY - Mon YYYY or Present"), followed by "- " bullets for that role's accomplishments.
  4. "## Career Highlights" — only if the source resume calls out standout achievements distinct from day-to-day Experience bullets worth listing separately; otherwise omit this section entirely.
  5. "## Notable Projects" — only if the source resume mentions specific named projects; otherwise omit this section entirely.
  6. "## Education" — degree, institution, and location/year if present.
- Use a single-column layout: no tables, no multi-column text, no images.
- Use "- " for bullet list items (never other bullet characters). Keep each bullet to one concise line of substance (roughly one sentence) — don't pad length.
- Don't insert blank lines between bullets within the same role, or between category lines — only use a single blank line to separate major sections/roles from each other.
- Use plain ASCII punctuation only: straight quotes ('/") and hyphens (-), never curly quotes, em/en dashes, ellipsis characters, or decorative symbols/emoji.
- Keep it plain, scannable body text — this file will be parsed by both automated ATS scanners and human recruiters.

${provider === "claude" ? "Provide" : "Return a single JSON object with"} exactly these fields, in this order:
- "company": the hiring company's name as stated in the job description, written normally with spaces (do not use underscores or camelCase). If it truly cannot be determined, use "Unknown Company".
- "roleTitle": the job title as stated in the job description, written normally with spaces (do not use underscores or camelCase). If it truly cannot be determined, use "Target Role".
- "interviewQuestions": an array of 8 to 12 separate likely interview question strings (not one combined string) the candidate should prepare for, based on the overlap between the job description and their experience. Generate this BEFORE writing the full resume text below.
- "adaptationNotes": NOT a resume summary — a short validation note (up to 5 lines, plain sentences separated by newlines, no bullets/markdown) telling the candidate specifically what was changed or emphasized to tailor this resume to this job description. Reference concrete overlaps, e.g. which skills/experience were reordered or emphasized and which JD requirements they map to. If special instructions were provided above, explicitly confirm how each one was applied (or note if one couldn't be followed and why). This is meta-commentary for the candidate to sanity-check the output, not part of the resume itself (at least 10 characters).
- "tailoredResume": the full rewritten resume per the ATS formatting rules above, tailored to the job description, based only on the candidate's actual resume content${specialInstructions ? " AND fully reflecting every candidate-directed instruction above" : ""} (at least 50 characters). Write this LAST.
${
  provider === "claude"
    ? "\nCall the return_tailored_resume tool with these fields in the order listed above — interviewQuestions must be an actual array with 8-12 separate string elements, not a single string, generated before tailoredResume."
    : "\nRespond with only the JSON object, no markdown fences, no commentary."
}`;
}

// Client-input problems (missing field, unsupported file type) — always a
// 400, never a fatal server issue. A typed class instead of matching on the
// message text so this can't silently break if wording ever changes.
class ValidationError extends Error {}

function errorStatus(err: unknown) {
  if (err instanceof FetchBlockedError) return 400;
  if (err instanceof ValidationError) return 400;
  return 500;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// History rows hold real resume/JD content indefinitely otherwise — cap
// retention rather than let a local sqlite file grow forever with PII.
const HISTORY_RETENTION_LIMIT = 50;

async function pruneOldGenerations() {
  const cutoffRow = await prisma.generation.findMany({
    orderBy: { createdAt: "desc" },
    skip: HISTORY_RETENTION_LIMIT,
    take: 1,
    select: { createdAt: true },
  });
  const cutoff = cutoffRow[0]?.createdAt;
  if (!cutoff) return;
  await prisma.generation.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

async function resolveJobDesc(
  form: FormData,
): Promise<{ text: string; applyUrl: string | null }> {
  const jobText = form.get("jobText");
  if (typeof jobText === "string" && jobText.trim().length > 0) {
    const text = jobText.trim();
    return { text, applyUrl: extractFirstUrl(text) };
  }

  const jobUrl = form.get("jobUrl");
  if (typeof jobUrl === "string" && jobUrl.trim().length > 0) {
    const trimmedUrl = jobUrl.trim();
    const { text } = await fetchTextFromUrl(trimmedUrl);
    // The link the user gave us is the job posting page itself — that's
    // normally also where "Apply" lives, so it's a trustworthy apply URL
    // (unlike anything we might try to scrape/guess from the page content).
    return { text, applyUrl: trimmedUrl };
  }

  throw new ValidationError("Missing jobUrl or jobText");
}

async function resolveResumeText(form: FormData): Promise<string> {
  const resumeFile = form.get("resumeFile");
  if (resumeFile instanceof File && resumeFile.size > 0) {
    const name = resumeFile.name.toLowerCase();
    const isPdf = resumeFile.type === "application/pdf" || name.endsWith(".pdf");
    const isDocx =
      resumeFile.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.endsWith(".docx");
    const isLegacyDoc = name.endsWith(".doc") && !isDocx;

    if (isLegacyDoc) {
      throw new ValidationError(
        "The older .doc format isn't supported — save as .docx or PDF and try again.",
      );
    }
    if (!isPdf && !isDocx) {
      throw new ValidationError("Only PDF or DOCX resumes are supported for file upload.");
    }

    const buf = Buffer.from(await resumeFile.arrayBuffer());
    return isPdf ? extractPdfBuffer(buf) : extractDocxBuffer(buf);
  }

  const resumeUrl = form.get("resumeUrl");
  if (typeof resumeUrl === "string" && resumeUrl.trim().length > 0) {
    const { text } = await fetchTextFromUrl(resumeUrl.trim());
    return text;
  }

  const resumeText = form.get("resumeText");
  if (typeof resumeText === "string" && resumeText.trim().length > 0) {
    return resumeText.trim();
  }

  throw new ValidationError("Missing resumeFile, resumeUrl, or resumeText");
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const streamMode = url.searchParams.get("stream") === "true";

    const form = await req.formData();

    const specialInstructionsRaw = form.get("specialInstructions");
    const specialInstructions =
      typeof specialInstructionsRaw === "string"
        ? specialInstructionsRaw.trim()
        : "";

    const provider: Provider = form.get("provider") === "claude" ? "claude" : "openai";

    let jobDesc: string;
    let applyUrl: string | null;
    try {
      ({ text: jobDesc, applyUrl } = await resolveJobDesc(form));
    } catch (err: unknown) {
      return NextResponse.json(
        {
          error:
            err instanceof FetchBlockedError
              ? "JD_FETCH_BLOCKED"
              : "JD_RESOLUTION_FAILED",
          message: errorMessage(err, "Failed to resolve job description"),
        },
        { status: errorStatus(err) },
      );
    }

    let experience: string;
    try {
      experience = await resolveResumeText(form);
    } catch (err: unknown) {
      return NextResponse.json(
        {
          error:
            err instanceof FetchBlockedError
              ? "RESUME_FETCH_BLOCKED"
              : "RESUME_RESOLUTION_FAILED",
          message: errorMessage(err, "Failed to resolve resume"),
        },
        { status: errorStatus(err) },
      );
    }

    if (useMock) {
      if (streamMode) {
        // STREAMING mock response (sends raw JSON chunks)
        const stream = new ReadableStream({
          async start(controller) {
            const gen = mockStreamingJson(jobDesc, experience, provider);
            for await (const chunk of gen) {
              controller.enqueue(chunk);
            }
            controller.close();
          },
        });
        return new NextResponse(stream, {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      } else {
        // NON-STREAM mock: validate and save
        const parsed = makeMockOutput(jobDesc, experience, provider);
        const valid = OutputSchema.parse(parsed);
        const saved = await prisma.generation.create({
          data: {
            jobDesc,
            experience,
            resultJson: JSON.stringify(valid),
            applyUrl,
            specialInstructions: specialInstructions || null,
          },
          select: { id: true, createdAt: true },
        });
        await pruneOldGenerations();
        return NextResponse.json({
          saved,
          result: valid,
          resumeText: experience,
          jobDescText: jobDesc,
          applyUrl,
          specialInstructions: specialInstructions || null,
        });
      }
    }

    const prompt = buildPrompt(jobDesc, experience, specialInstructions, provider);
    if (streamMode) {
      // Example: if you later implement real streaming, you'd stream tokens here.
      // For now, short-circuit to error if user asked to stream but not mocked.
      return NextResponse.json(
        { error: "Streaming with a real provider not implemented here" },
        { status: 501 },
      );
    } else {
      const parsed = await callModel(provider, prompt);
      const saved = await prisma.generation.create({
        data: {
          jobDesc,
          experience,
          resultJson: JSON.stringify(parsed),
          applyUrl,
          specialInstructions: specialInstructions || null,
        },
        select: { id: true, createdAt: true },
      });
      await pruneOldGenerations();
      return NextResponse.json({
        saved,
        result: parsed,
        resumeText: experience,
        jobDescText: jobDesc,
        applyUrl,
        specialInstructions: specialInstructions || null,
        provider,
      });
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { error: errorMessage(err, "Unknown error") },
      { status: 500 },
    );
  }
}
