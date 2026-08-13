// lib/resumeBlocks.ts
// Parses the model's markdown-ish tailoredResume string into small editable
// blocks for the document editor, and serializes edited blocks back to
// markdown (for PDF generation) or fully plain text (for copy/paste into
// any plain input field — no "#"/"-" markdown syntax left in).
//
// Heading level is preserved: "##" (or "#") is a major section heading
// (Technical Skills, Professional Experience, ...), "###" is a sub-heading
// used for per-role lines within Experience (title | company - dates).

export type ResumeBlock =
  | { id: string; type: "heading"; level: number; text: string }
  | { id: string; type: "bullet"; text: string }
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "blank" };

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `block-${idCounter}`;
}

export function parseResumeMarkdown(markdown: string): ResumeBlock[] {
  const lines = (markdown ?? "").split("\n");
  const blocks: ResumeBlock[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().length === 0) {
      blocks.push({ id: nextId(), type: "blank" });
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        id: nextId(),
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      blocks.push({ id: nextId(), type: "bullet", text: bulletMatch[1].trim() });
      continue;
    }

    blocks.push({ id: nextId(), type: "paragraph", text: line.trim() });
  }

  return blocks;
}

function nonEmpty(blocks: ResumeBlock[]) {
  return blocks.filter((b) => b.type === "blank" || b.text.trim().length > 0);
}

export function blocksToMarkdown(blocks: ResumeBlock[]): string {
  return nonEmpty(blocks)
    .map((b) => {
      if (b.type === "blank") return "";
      if (b.type === "heading") return `${"#".repeat(b.level)} ${b.text}`;
      if (b.type === "bullet") return `- ${b.text}`;
      return b.text;
    })
    .join("\n");
}

export function blocksToPlainText(blocks: ResumeBlock[]): string {
  return nonEmpty(blocks)
    .map((b) => {
      if (b.type === "blank") return "";
      if (b.type === "heading") return b.level <= 2 ? b.text.toUpperCase() : b.text;
      if (b.type === "bullet") return `- ${b.text}`;
      return b.text;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
