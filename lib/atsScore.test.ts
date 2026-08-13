import { describe, expect, it } from "vitest";
import { computeAtsScore } from "./atsScore";
import { parseResumeMarkdown } from "./resumeBlocks";

const GOOD_RESUME = `Jordan Rivera
jordan.rivera@example.com | (555) 123-4567 | Boston, MA

## Technical Skills

Leadership: Team Building, Mentoring; Cloud and Infrastructure: AWS, Kubernetes, Docker

## Professional Summary

Engineering leader with a decade of experience shipping cloud-native platforms and leading teams.

## Professional Experience

### Senior Engineering Manager | Acme Corp, Boston, MA - Jan 2023 - Present

- Provided team leadership and mentoring for six engineers delivering platform infrastructure on AWS and Kubernetes.
- Reduced deploy time by seventy percent through improved CI/CD pipelines.

## Education

BSc Computer Science | State University`;

const JD = `Senior Platform Engineer at Nimbus Systems. Looking for AWS, Kubernetes, CI/CD, team leadership, mentoring experience.`;

describe("computeAtsScore", () => {
  it("scores a well-formed, JD-aligned resume highly", () => {
    const blocks = parseResumeMarkdown(GOOD_RESUME);
    const result = computeAtsScore(blocks, JD, "Nimbus Systems");
    expect(result.score).toBeGreaterThanOrEqual(85);
  });

  it("fails the contact-info check when there's no email or phone", () => {
    const blocks = parseResumeMarkdown("## Summary\n\nNo contact details anywhere in this text.");
    const result = computeAtsScore(blocks, "", "");
    const contactCheck = result.checks.find((c) => c.label.includes("Contact info"));
    expect(contactCheck?.passed).toBe(false);
  });

  it("fails the length check for a resume over ~800 words", () => {
    const longBullets = Array.from({ length: 120 }, (_, i) => `- Bullet number ${i} with several words of padding text here`).join("\n");
    const blocks = parseResumeMarkdown(`jordan@example.com\n\n## Experience\n\n${longBullets}`);
    const result = computeAtsScore(blocks, "", "");
    const lengthCheck = result.checks.find((c) => c.label.startsWith("Reasonable length"));
    expect(lengthCheck?.passed).toBe(false);
  });

  it("excludes the company's own name from the JD keyword list", () => {
    const blocks = parseResumeMarkdown(GOOD_RESUME);
    const result = computeAtsScore(blocks, JD, "Nimbus Systems");
    const keywordCheck = result.checks.find((c) => c.label.startsWith("Keyword overlap"));
    expect(keywordCheck?.label).not.toMatch(/\bnimbus\b/i);
    expect(keywordCheck?.label).not.toMatch(/\bsystems\b/i);
  });

  it("reports lower keyword overlap when JD terms are absent from the resume", () => {
    const blocks = parseResumeMarkdown("jordan@example.com\n\n## Summary\n\nGeneric text with nothing job-specific in it at all.");
    const result = computeAtsScore(
      blocks,
      "Requires expertise in Kubernetes, Terraform, and PostgreSQL administration.",
      "",
    );
    const keywordCheck = result.checks.find((c) => c.label.startsWith("Keyword overlap"));
    expect(keywordCheck?.passed).toBe(false);
  });

  it("always passes the structural single-column check (guaranteed by this app's own renderer)", () => {
    const blocks = parseResumeMarkdown("jordan@example.com");
    const result = computeAtsScore(blocks, "", "");
    const structureCheck = result.checks.find((c) => c.label.includes("Single-column"));
    expect(structureCheck?.passed).toBe(true);
  });
});
