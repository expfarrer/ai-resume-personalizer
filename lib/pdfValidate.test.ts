import { describe, expect, it } from "vitest";
import { buildResumePdf } from "./pdfBuilder";
import { validatePdfExtraction } from "./pdfValidate";

const GOOD_RESUME = `Jordan Rivera
jordan.rivera@example.com | (555) 123-4567 | Boston, MA

## Summary

Engineering leader with a decade of experience shipping cloud-native platforms.

## Experience

### Engineering Manager | Acme Corp, Boston, MA - Jan 2023 - Present

- Led a team of six engineers delivering platform infrastructure on AWS.
- Reduced deploy time by seventy percent through improved CI/CD pipelines.

## Education

BSc Computer Science | State University`;

describe("validatePdfExtraction", () => {
  it("passes all checks for a well-formed resume, independently re-extracted", async () => {
    const pdfBytes = await buildResumePdf({
      company: "Acme Corp",
      roleTitle: "Engineering Manager",
      tailoredResume: GOOD_RESUME,
    });
    const result = await validatePdfExtraction(pdfBytes, GOOD_RESUME);

    expect(result.passed).toBe(true);
    for (const check of result.checks) {
      expect(check.passed, check.label).toBe(true);
    }
    // Independent extraction should recover roughly the same word count —
    // this is the whole point: catching generation bugs the rendering code
    // can't see about itself.
    expect(result.extractedWordCount).toBeGreaterThan(result.sourceWordCount * 0.85);
    expect(result.extractedWordCount).toBeLessThan(result.sourceWordCount * 1.15);
  }, 20000);

  it("fails the contact-info check when the resume has none", async () => {
    const noContact = "## Summary\n\nA resume with no email or phone number anywhere in it.";
    const pdfBytes = await buildResumePdf({
      company: "Acme",
      roleTitle: "Engineer",
      tailoredResume: noContact,
    });
    const result = await validatePdfExtraction(pdfBytes, noContact);

    expect(result.passed).toBe(false);
    const contactCheck = result.checks.find((c) => c.label.includes("Contact info"));
    expect(contactCheck?.passed).toBe(false);
  }, 20000);

  it("has a real, non-empty text layer for normal content", async () => {
    const pdfBytes = await buildResumePdf({
      company: "Acme",
      roleTitle: "Engineer",
      tailoredResume: "jordan@example.com\n\n## Summary\n\nSome real content here.",
    });
    const result = await validatePdfExtraction(
      pdfBytes,
      "jordan@example.com\n\n## Summary\n\nSome real content here.",
    );
    const textLayerCheck = result.checks.find((c) => c.label.includes("text layer"));
    expect(textLayerCheck?.passed).toBe(true);
  }, 20000);
});
