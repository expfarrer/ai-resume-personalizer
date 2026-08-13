import { describe, expect, it } from "vitest";
import { extractFirstUrl, resolveDirectUrl } from "./sourceFetcher";

describe("resolveDirectUrl", () => {
  it("forces dl=1 on Dropbox share links (dl=0 shows a preview page, not the file)", () => {
    const result = resolveDirectUrl(
      "https://www.dropbox.com/scl/fi/abc123/resume.pdf?rlkey=xyz&dl=0",
    );
    expect(new URL(result).searchParams.get("dl")).toBe("1");
  });

  it("adds dl=1 even when the Dropbox link has no dl param at all", () => {
    const result = resolveDirectUrl("https://www.dropbox.com/scl/fi/abc123/resume.pdf");
    expect(new URL(result).searchParams.get("dl")).toBe("1");
  });

  it("converts a Google Drive /file/d/ view link to a direct-download URL", () => {
    const result = resolveDirectUrl(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing",
    );
    expect(result).toBe(
      "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp",
    );
  });

  it("passes through unrelated URLs unchanged", () => {
    const url = "https://example.com/some/job/posting";
    expect(resolveDirectUrl(url)).toBe(url);
  });
});

describe("extractFirstUrl", () => {
  it("finds a URL embedded in plain text", () => {
    expect(
      extractFirstUrl("Apply at https://careers.acme.com/apply/999 before Friday."),
    ).toBe("https://careers.acme.com/apply/999");
  });

  it("returns null when there's no URL", () => {
    expect(extractFirstUrl("Just a plain job description with no links at all.")).toBeNull();
  });

  it("stops at trailing punctuation/quotes rather than swallowing them", () => {
    expect(extractFirstUrl('See "https://example.com/job" for details.')).toBe(
      "https://example.com/job",
    );
  });
});
