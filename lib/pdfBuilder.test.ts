import { describe, expect, it } from "vitest";
import { buildAsciiFilename, buildResumeFilename, buildResumePdf } from "./pdfBuilder";

describe("buildResumeFilename", () => {
  it("joins company and role title", () => {
    expect(buildResumeFilename("Acme Corp", "Senior Engineer")).toBe(
      "Acme Corp - Senior Engineer - Resume.pdf",
    );
  });

  it("strips filesystem-reserved characters", () => {
    expect(buildResumeFilename('Acme/Corp:Test?"<>|', "Role")).toBe(
      "AcmeCorpTest - Role - Resume.pdf",
    );
  });

  it("falls back to a generic name when both inputs are empty", () => {
    expect(buildResumeFilename("", "")).toBe("Resume.pdf");
  });
});

describe("buildAsciiFilename", () => {
  it("passes plain ASCII filenames through unchanged", () => {
    expect(buildAsciiFilename("Acme Corp - Senior Engineer - Resume.pdf")).toBe(
      "Acme Corp - Senior Engineer - Resume.pdf",
    );
  });

  it("transliterates accented Latin characters instead of mangling them", () => {
    expect(buildAsciiFilename("Société Générale - Resume.pdf")).toBe(
      "Societe Generale - Resume.pdf",
    );
  });

  it("replaces non-Latin1 characters (e.g. curly quotes) rather than throwing", () => {
    const result = buildAsciiFilename("Acme “Test” Co. - Resume.pdf");
    expect(result).not.toMatch(/[‘’“”]/);
    // Must stay within the ByteString-safe printable ASCII range used for
    // HTTP Content-Disposition headers.
    expect(result).toMatch(/^[\x20-\x7E]*$/);
  });

  it("never returns an empty string", () => {
    expect(buildAsciiFilename("")).toBe("Resume.pdf");
  });
});

describe("buildResumePdf", () => {
  it("produces a non-empty, valid PDF for normal content", async () => {
    const bytes = await buildResumePdf({
      company: "Acme Corp",
      roleTitle: "Senior Engineer",
      tailoredResume: "Jordan Rivera\njordan@example.com\n\n## Summary\n\n- Did a thing",
    });
    expect(bytes.length).toBeGreaterThan(100);
    // PDF files start with the "%PDF-" magic bytes.
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("never throws on adversarial content (emoji, CJK, curly quotes, markdown artifacts)", async () => {
    const adversarial = `Jordan “Jay” Candidate
jordan@example.com • (555) 123-4567 — Boston, MA

## Summary

Results‑driven engineer ✓ with emoji 🚀🔥 and CJK: 日本語テスト.

## Experience

- **Led** a team using *React* and __Node__ — improved throughput by 30% → 45%.
- Used ® ™ © symbols and a checkmark ✔ plus an arrow ←.`;

    await expect(
      buildResumePdf({
        company: 'Acme “Test” Co.',
        roleTitle: "Senior Engineer — Backend",
        tailoredResume: adversarial,
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
