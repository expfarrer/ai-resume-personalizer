// lib/mockOpenAI.ts
// Deterministic mock output + two streaming helpers:
// - mockStreamingJson: yields chunks of raw JSON (useful for simple stream tests)
// - mockNdjsonStream: yields NDJSON {type:"chunk", text:"..."}\n lines (used by NDJSON client)
//
// Provider-aware on purpose: the two mocks are deliberately different in
// length/structure (not just relabeled) so compare mode's UI — two panels
// side by side — has something real to render and differentiate while
// testing, without spending real API calls.

import { Output } from "./schema";

export type MockProvider = "openai" | "claude";

function deriveRoleTitle(jobDesc: string): string {
  return (
    jobDesc
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0)
      ?.slice(0, 60) || "Target Role"
  );
}

function deriveCandidateName(experience: string): string {
  const firstLine = experience
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && l.length < 40);
  return firstLine || "Jordan Candidate";
}

/**
 * Deterministic mock that matches Output shape. Varies noticeably by
 * provider so the two compare-mode panels don't render identical content.
 */
export function makeMockOutput(
  jobDesc: string,
  experience: string,
  provider: MockProvider = "openai",
): Output {
  const roleTitle = deriveRoleTitle(jobDesc);
  const name = deriveCandidateName(experience);
  const company = "Sample Company";

  if (provider === "claude") {
    const adaptationNotes = `Reordered Professional Experience to lead with cloud migration and platform-scaling work, since the JD emphasizes both. Expanded Technical Skills to explicitly name AWS, Kubernetes, and CI/CD using the JD's own terminology for keyword matching. Added a Notable Projects section since the source resume mentions a couple of named side projects worth calling out separately. No employers, dates, or metrics were invented — everything below is reorganized from the source resume only.`;

    const tailoredResume = `${name}
jordan.candidate@example.com | (555) 123-4567 | Boston, MA | linkedin.com/in/jordancandidate

## Technical Skills

Leadership: Team Building, Mentoring, Roadmapping, Stakeholder Management; Cloud and Infrastructure: AWS, Kubernetes, Docker, CI/CD; Languages and Frameworks: JavaScript, TypeScript, React, Next.js, Node.js

## Professional Summary

Engineering leader with hands-on experience scaling cloud-native platforms and leading distributed teams, tailored to this role's platform and developer-tooling focus.

## Professional Experience

### Engineering Manager | Sample Company, Boston, MA - Jan 2023 - Present

- Led a 6-person team to deliver a React/Next product, improving conversion by 18%.
- Designed CI/CD pipelines reducing deploy time by 75%.
- Migrated JS to TypeScript, reducing runtime errors and improving DX.
- Added observability and SLOs for Tier-1 services, lowering MTTR.
- Mentored engineers and shortened onboarding from 4 weeks to 1 week.

### Senior Engineer | Prior Company, Boston, MA - Jun 2020 - Dec 2022

- Migrated legacy services to containerized infrastructure on AWS.
- Established CI/CD conventions adopted across three teams.

## Career Highlights

- Recognized for cross-functional leadership and measurable delivery impact.
- Reduced onboarding time company-wide through shared tooling and documentation.

## Notable Projects

- Internal Developer Portal: self-serve platform for provisioning cloud resources, cutting environment setup time from days to hours.

## Education

B.Sc., Computer Science | Sample University`;

    const interviewQuestions = [
      "Describe a time you reduced technical debt while delivering features.",
      "How do you measure team velocity and engineer impact?",
      "Explain an architectural trade-off you recently made.",
      "How would you onboard a new senior engineer in month one?",
      "Tell me about a production incident you led.",
      "What observability signals do you track for user-facing services?",
      "Describe your approach to cross-team communication.",
      "How do you prioritize feature requests from product stakeholders?",
      "Explain your experience migrating a codebase to TypeScript.",
      "Give an example of successful mentorship you've run.",
      "Walk me through how you'd design a CI/CD pipeline from scratch.",
      "How do you decide what belongs in an internal developer platform?",
    ];

    const coverLetter = `${name}
jordan.candidate@example.com | (555) 123-4567 | Boston, MA

Dear Hiring Manager,

I'm writing to apply for the ${roleTitle} role at ${company}. In my current role as Engineering Manager, I've led a 6-person team delivering a React/Next platform, cut deploy time by 75% through redesigned CI/CD pipelines, and built the observability practices that keep our Tier-1 services reliable — work that lines up directly with what this role calls for.

Beyond the day-to-day delivery, I care about building teams that get better over time: I mentor engineers, shortened new-hire onboarding from four weeks to one, and led the migration of our JavaScript codebase to TypeScript to cut down on runtime errors. I'd bring that same combination of hands-on platform work and team leadership to ${company}.

I'd welcome the chance to talk through how my background fits what you're building. Thank you for your consideration.

Sincerely,
${name}`;

    return { company, roleTitle, adaptationNotes, tailoredResume, coverLetter, interviewQuestions };
  }

  // openai mock: shorter and more concise, mirroring the real difference
  // observed between providers this session.
  const adaptationNotes = `Reordered Technical Skills to lead with Cloud and Infrastructure to match this role's platform focus.
Emphasized team-scaling and mentorship bullets that map to the JD's leadership requirements.
Moved CI/CD and observability achievements higher since the JD calls out platform reliability.`;

  const tailoredResume = `${name}
jordan.candidate@example.com | (555) 123-4567 | Boston, MA | linkedin.com/in/jordancandidate
Engineering Leader | Platform Engineering | Developer Experience

## Technical Skills

Leadership: Team Building, Mentoring, Roadmapping, Stakeholder Management
Languages and Frameworks: JavaScript, TypeScript, React, Next.js, Node.js
Cloud and Infrastructure: AWS, Docker, Kubernetes, CI/CD

## Professional Summary

Experienced engineering leader with hands-on experience building scalable web platforms, tailored to the target role.

## Professional Experience

### Engineering Manager | Sample Company, Boston, MA - Jan 2023 - Present

- Led a 6-person team to deliver a React/Next product, improving conversion by 18%.
- Designed CI/CD pipelines reducing deploy time by 75%.
- Migrated JS to TypeScript, reducing runtime errors and improving DX.
- Added observability and SLOs for Tier-1 services, lowering MTTR.
- Mentored engineers and shortened onboarding from 4 weeks to 1 week.

## Career Highlights

- Recognized for cross-functional leadership and measurable delivery impact.

## Education

B.Sc., Computer Science | Sample University`;

  const interviewQuestions = [
    "Describe a time you reduced technical debt while delivering features.",
    "How do you measure team velocity and engineer impact?",
    "Explain an architectural trade-off you recently made.",
    "How would you onboard a new senior engineer in month one?",
    "Tell me about a production incident you led.",
    "What observability signals do you track for user-facing services?",
    "Describe your approach to cross-team communication.",
    "How do you prioritize feature requests from product stakeholders?",
  ];

  const coverLetter = `${name}
jordan.candidate@example.com | (555) 123-4567 | Boston, MA

Dear Hiring Manager,

I'm excited to apply for the ${roleTitle} position at ${company}. As an engineering leader with hands-on experience building scalable web platforms, I led a 6-person team to ship a React/Next product that improved conversion by 18%, and redesigned our CI/CD pipelines to cut deploy time by 75%.

I'd bring that same track record of platform ownership and team leadership to ${company}, and I'd welcome the opportunity to discuss how my background fits your team's needs.

Sincerely,
${name}`;

  return { company, roleTitle, adaptationNotes, tailoredResume, coverLetter, interviewQuestions };
}

/**
 * Simple streaming mock that yields raw JSON chunks (Uint8Array).
 * This simulates a provider that streams raw JSON text token-by-token.
 */
export function mockStreamingJson(
  jobDesc: string,
  experience: string,
  provider: MockProvider = "openai",
) {
  const out = makeMockOutput(jobDesc, experience, provider);
  const json = JSON.stringify(out);

  // Break the JSON into small chunks to simulate token streaming
  const chunkSize = 40;
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += chunkSize) {
    chunks.push(json.slice(i, i + chunkSize));
  }

  async function* gen() {
    for (const chunk of chunks) {
      await new Promise((r) => setTimeout(r, 60)); // small delay to simulate streaming
      yield new TextEncoder().encode(chunk);
    }
  }

  return gen();
}

/**
 * NDJSON streaming generator: yields newline-delimited JSON strings as Uint8Array chunks.
 * Each line is a JSON object like: { "type": "chunk", "text": "..." }\n ... and ends with { "type": "done" }.
 * This is useful if your client expects NDJSON (the StreamGenerator component does).
 */
export async function* mockNdjsonStream(
  jobDesc: string,
  experience: string,
  provider: MockProvider = "openai",
) {
  const out = makeMockOutput(jobDesc, experience, provider);
  const json = JSON.stringify(out);

  // Break up the JSON into token-like pieces
  const chunkSize = 50;
  for (let i = 0; i < json.length; i += chunkSize) {
    const slice = json.slice(i, i + chunkSize);
    const line = JSON.stringify({ type: "chunk", text: slice }) + "\n";
    await new Promise((r) => setTimeout(r, 70));
    yield new TextEncoder().encode(line);
  }

  // final marker
  const doneLine = JSON.stringify({ type: "done" }) + "\n";
  yield new TextEncoder().encode(doneLine);
}
