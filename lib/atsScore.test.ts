import { describe, expect, it } from "vitest";
import { computeAtsScore } from "./atsScore";
import { parseResumeMarkdown } from "./resumeBlocks";

const GOOD_RESUME = `Jordan Rivera
jordan.rivera@example.com | (555) 123-4567 | 123 Main Street, Boston, MA 02134

## Technical Skills

Leadership: Team Building, Mentoring; Cloud and Infrastructure: AWS, Kubernetes, Docker

## Professional Summary

Engineering leader with a decade of experience shipping cloud-native platforms and leading teams.

## Professional Experience

### Senior Engineering Manager | Acme Corp, Boston, MA - Jan 2023 - Present

- Provided team leadership and mentoring for six engineers delivering platform infrastructure on AWS and Kubernetes.
- Reduced deploy time by seventy percent through improved CI/CD pipelines.

## Education

Bachelor of Science (B.S.), Computer Science | State University, Boston, MA - 2013`;

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

  it("flags a missing street address", () => {
    const blocks = parseResumeMarkdown("Jordan Rivera\njordan@example.com | Boston, MA");
    const result = computeAtsScore(blocks, "", "");
    const check = result.checks.find((c) => c.label.startsWith("Street address"));
    expect(check?.passed).toBe(false);
  });

  it("flags missing city/state/ZIP when only a region is given", () => {
    const blocks = parseResumeMarkdown("Jordan Rivera\njordan@example.com | Greater Boston Area");
    const result = computeAtsScore(blocks, "", "");
    const check = result.checks.find((c) => c.label.includes("ZIP"));
    expect(check?.passed).toBe(false);
  });

  it("passes address checks with a full street/city/state/ZIP", () => {
    const blocks = parseResumeMarkdown(
      "Jordan Rivera\njordan@example.com | 123 Main Street, Boston, MA 02134",
    );
    const result = computeAtsScore(blocks, "", "");
    expect(result.checks.find((c) => c.label.startsWith("Street address"))?.passed).toBe(true);
    expect(result.checks.find((c) => c.label.startsWith("City, state"))?.passed).toBe(true);
  });

  it("flags a freelance-style experience entry with no distinct company field", () => {
    const blocks = parseResumeMarkdown(
      "Jordan Rivera\njordan@example.com\n\n## Experience\n\n### Consultant | Germany - 2018 - Present\n\n- Did consulting work.",
    );
    const result = computeAtsScore(blocks, "", "");
    const check = result.checks.find((c) => c.label.includes("Job title"));
    expect(check?.passed).toBe(false);
  });

  it("passes the job title check when a company (or Self-Employed) is present", () => {
    const blocks = parseResumeMarkdown(
      "Jordan Rivera\njordan@example.com\n\n## Experience\n\n### Consultant | Self-Employed, Berlin, Germany - 2018 - Present\n\n- Did consulting work.",
    );
    const result = computeAtsScore(blocks, "", "");
    const check = result.checks.find((c) => c.label.includes("Job title"));
    expect(check?.passed).toBe(true);
  });

  it("flags an Education line with no clear degree/institution separation", () => {
    const blocks = parseResumeMarkdown(
      "Jordan Rivera\njordan@example.com\n\n## Education\n\nState University, Boston, MA",
    );
    const result = computeAtsScore(blocks, "", "");
    const check = result.checks.find((c) => c.label.includes("Degree"));
    expect(check?.passed).toBe(false);
  });

  it("passes the education check with a clear Degree | Institution pattern", () => {
    const blocks = parseResumeMarkdown(
      "Jordan Rivera\njordan@example.com\n\n## Education\n\nBachelor of Science, Computer Science | State University, Boston, MA - 2013",
    );
    const result = computeAtsScore(blocks, "", "");
    const check = result.checks.find((c) => c.label.includes("Degree"));
    expect(check?.passed).toBe(true);
  });
});
