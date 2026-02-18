// lib/mockOpenAI.ts
// Deterministic mock output + two streaming helpers:
// - mockStreamingJson: yields chunks of raw JSON (useful for simple stream tests)
// - mockNdjsonStream: yields NDJSON {type:"chunk", text:"..."}\n lines (used by NDJSON client)

import { Output } from "./schema";

/**
 * Deterministic mock that matches Output shape.
 */
export function makeMockOutput(jobDesc: string, experience: string): Output {
  const summary = `Experienced engineering leader with hands-on
experience building scalable web platforms aligned to product goals.`;

  const resumeBullets = [
    "Led a 6-person team to deliver a React/Next product, improving conversion by 18%.",
    "Designed CI/CD pipelines reducing deploy time by 75%.",
    "Migrated JS to TypeScript, reducing runtime errors and improving DX.",
    "Added observability and SLOs for Tier-1 services, lowering MTTR.",
    "Mentored engineers and shortened onboarding from 4 weeks to 1 week.",
  ];

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
    "Give an example of successful mentorship you've run?",
  ];

  return { summary, resumeBullets, interviewQuestions };
}

/**
 * Simple streaming mock that yields raw JSON chunks (Uint8Array).
 * This simulates a provider that streams raw JSON text token-by-token.
 */
export function mockStreamingJson(jobDesc: string, experience: string) {
  const out = makeMockOutput(jobDesc, experience);
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
export async function* mockNdjsonStream(jobDesc: string, experience: string) {
  const out = makeMockOutput(jobDesc, experience);
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
