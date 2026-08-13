import { describe, expect, it } from "vitest";
import { blocksToMarkdown, blocksToPlainText, parseResumeMarkdown } from "./resumeBlocks";

const SAMPLE_MD = `Jordan Rivera
jordan@example.com

## Technical Skills

Leadership: Team Building, Mentoring

## Professional Experience

### Engineering Manager | Acme Corp - Jan 2023 - Present

- Did a thing
- Did another thing

## Education

BSc Computer Science`;

describe("parseResumeMarkdown", () => {
  it("assigns heading levels correctly for ## vs ###", () => {
    const blocks = parseResumeMarkdown(SAMPLE_MD);
    const headings = blocks
      .filter((b) => b.type === "heading")
      .map((b) => ({ level: b.level, text: b.text }));

    expect(headings).toEqual([
      { level: 2, text: "Technical Skills" },
      { level: 2, text: "Professional Experience" },
      { level: 3, text: "Engineering Manager | Acme Corp - Jan 2023 - Present" },
      { level: 2, text: "Education" },
    ]);
  });

  it("parses bullets and paragraphs distinctly", () => {
    const blocks = parseResumeMarkdown(SAMPLE_MD);
    const bullets = blocks.filter((b) => b.type === "bullet").map((b) => b.text);
    expect(bullets).toEqual(["Did a thing", "Did another thing"]);

    const paragraphs = blocks.filter((b) => b.type === "paragraph").map((b) => b.text);
    expect(paragraphs).toContain("Jordan Rivera");
    expect(paragraphs).toContain("jordan@example.com");
  });

  it("gives every block a unique id", () => {
    const blocks = parseResumeMarkdown(SAMPLE_MD);
    const ids = blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("blocksToMarkdown", () => {
  it("round-trips losslessly for well-formed input", () => {
    const blocks = parseResumeMarkdown(SAMPLE_MD);
    expect(blocksToMarkdown(blocks)).toBe(SAMPLE_MD);
  });

  it("drops blocks whose text was edited down to empty", () => {
    const blocks = parseResumeMarkdown("- keep this\n- delete this");
    const edited = blocks.map((b) =>
      b.type === "bullet" && b.text === "delete this" ? { ...b, text: "   " } : b,
    );
    expect(blocksToMarkdown(edited)).toBe("- keep this");
  });
});

describe("blocksToPlainText", () => {
  it("uppercases major (##) headings but not sub-headings (###)", () => {
    const blocks = parseResumeMarkdown(SAMPLE_MD);
    const plain = blocksToPlainText(blocks);
    expect(plain).toContain("TECHNICAL SKILLS");
    expect(plain).toContain("PROFESSIONAL EXPERIENCE");
    expect(plain).toContain("Engineering Manager | Acme Corp - Jan 2023 - Present");
    expect(plain).not.toContain("ENGINEERING MANAGER");
  });

  it("strips markdown syntax entirely", () => {
    const blocks = parseResumeMarkdown(SAMPLE_MD);
    const plain = blocksToPlainText(blocks);
    expect(plain).not.toMatch(/^#{1,3}\s/m);
  });

  it("keeps bullet prefixes as plain hyphens", () => {
    const blocks = parseResumeMarkdown("- one\n- two");
    expect(blocksToPlainText(blocks)).toBe("- one\n- two");
  });
});
