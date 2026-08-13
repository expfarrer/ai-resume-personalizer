import { describe, expect, it } from "vitest";
import { normalizeForAts } from "./atsNormalize";

describe("normalizeForAts", () => {
  it("title-cases an all-caps name on the first line", () => {
    const input = "THERESA CONIO\ntheresa.conio@gmail.com | +1 774 477 4594\n\n## Skills\n\n- Thing";
    const out = normalizeForAts(input);
    expect(out.split("\n")[0]).toBe("Theresa Conio");
  });

  it("leaves an already-normal-case name untouched", () => {
    const input = "Theresa Conio\ntheresa.conio@gmail.com";
    expect(normalizeForAts(input).split("\n")[0]).toBe("Theresa Conio");
  });

  it("leaves a short/likely-non-name all-caps first line untouched", () => {
    const input = "OK\nsome contact line";
    expect(normalizeForAts(input).split("\n")[0]).toBe("OK");
  });

  it("reformats a +1-prefixed, space-separated phone number to (XXX) XXX-XXXX", () => {
    const input = "Theresa Conio\ntheresa.conio@gmail.com | +1 774 477 4594 | Boston, MA";
    const out = normalizeForAts(input);
    expect(out).toContain("(774) 477-4594");
    expect(out).not.toContain("+1 774 477 4594");
  });

  it("leaves an already-well-formatted phone number unchanged", () => {
    const input = "Jane Doe\njane@example.com | (555) 123-4567";
    const out = normalizeForAts(input);
    expect(out).toContain("(555) 123-4567");
  });

  it("does not touch digit sequences in the resume body, only the header", () => {
    const input =
      "Jane Doe\njane@example.com | +1 555 123 4567\n\n## Experience\n\n- Grew revenue from 1234567890 to 2000000000";
    const out = normalizeForAts(input);
    expect(out).toContain("(555) 123-4567");
    expect(out).toContain("Grew revenue from 1234567890 to 2000000000");
  });
});
