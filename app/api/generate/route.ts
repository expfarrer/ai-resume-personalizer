// app/api/generate/route.ts
import { NextResponse } from "next/server";
import { OutputSchema } from "@/lib/schema";
import { prisma } from "@/lib/prisma";
import { makeMockOutput, mockStreamingJson } from "@/lib/mockOpenAI";
import OpenAI from "openai";

export const runtime = "nodejs";
const useMock = process.env.MOCK_OPENAI === "true";

const client = useMock
  ? null
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildPrompt(jobDesc: string, experience: string) {
  return `...`; // same prompt builder as before
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const streamMode = url.searchParams.get("stream") === "true";

    const { jobDesc, experience } = (await req.json()) as {
      jobDesc?: string;
      experience?: string;
    };
    if (!jobDesc || !experience) {
      return NextResponse.json(
        { error: "Missing jobDesc or experience" },
        { status: 400 },
      );
    }

    if (useMock) {
      if (streamMode) {
        // STREAMING mock response (sends raw JSON chunks)
        const stream = new ReadableStream({
          async start(controller) {
            const gen = mockStreamingJson(jobDesc, experience);
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
        const parsed = makeMockOutput(jobDesc, experience);
        const valid = OutputSchema.parse(parsed);
        const saved = await prisma.generation.create({
          data: { jobDesc, experience, resultJson: JSON.stringify(valid) },
          select: { id: true, createdAt: true },
        });
        return NextResponse.json({ saved, result: valid });
      }
    }

    // REAL OpenAI flow (unchanged)...
    const prompt = buildPrompt(jobDesc, experience);
    if (streamMode) {
      // Example: if you later implement real streaming, you'd stream tokens here.
      // For now, short-circuit to error if user asked to stream but not mocked.
      return NextResponse.json(
        { error: "Streaming with real OpenAI not implemented here" },
        { status: 501 },
      );
    } else {
      const resp = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: "You return strict JSON only." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      const text = resp.choices[0]?.message?.content ?? "";
      const parsed = OutputSchema.parse(JSON.parse(text));
      const saved = await prisma.generation.create({
        data: { jobDesc, experience, resultJson: JSON.stringify(parsed) },
        select: { id: true, createdAt: true },
      });
      return NextResponse.json({ saved, result: parsed });
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
