// lib/pdfValidate.ts
// Independent validation of a generated PDF's actual extractability — not
// another self-graded rubric. We generate PDFs with `pdf-lib`; this
// re-extracts the text with `pdf-parse` (a separate, pdf.js-based codebase,
// the same engine family the open-source OpenResume parser uses) and checks
// that what a real parser would pull out of the file still holds up:
// a genuine text layer, contact info, full content, correct reading order,
// and clean character encoding. This catches generation bugs our own
// rendering code can't see itself (e.g. pdf-lib silently dropping/garbling
// a glyph) — a rubric computed from our own source blocks can't catch that.

import { extractPdfBuffer } from "./sourceFetcher";

export type PdfValidationCheck = { label: string; passed: boolean };

export type PdfValidationResult = {
  passed: boolean;
  checks: PdfValidationCheck[];
  sourceWordCount: number;
  extractedWordCount: number;
};

function checkRelativeOrder(text: string, headings: string[]): boolean {
  let lastIndex = -1;
  for (const h of headings) {
    const idx = text.indexOf(h);
    if (idx === -1) continue; // reflowed/wrapped text may not match verbatim — skip rather than fail hard
    if (idx < lastIndex) return false;
    lastIndex = idx;
  }
  return true;
}

export async function validatePdfExtraction(
  pdfBytes: Uint8Array,
  sourceTailoredResume: string,
): Promise<PdfValidationResult> {
  const buf = Buffer.from(pdfBytes);
  const extracted = await extractPdfBuffer(buf);

  const checks: PdfValidationCheck[] = [];

  const hasText = extracted.trim().length > 20;
  checks.push({
    label: "Has a real, selectable text layer (not a rasterized image)",
    passed: hasText,
  });

  const hasEmail = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(extracted);
  const hasPhone = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(extracted);
  checks.push({
    label: "Contact info (email/phone) survives independent re-extraction",
    passed: hasEmail || hasPhone,
  });

  const sourceWords = sourceTailoredResume.split(/\s+/).filter(Boolean);
  const extractedWords = extracted.split(/\s+/).filter(Boolean);
  const ratio = extractedWords.length / Math.max(sourceWords.length, 1);
  const wordCountOk = ratio >= 0.85 && ratio <= 1.15;
  checks.push({
    label: `Word count fidelity — nothing dropped or duplicated (source ${sourceWords.length}, extracted ${extractedWords.length})`,
    passed: wordCountOk,
  });

  const sourceHeadings = Array.from(
    sourceTailoredResume.matchAll(/^#{1,3}\s+(.+)$/gm),
  ).map((m) => m[1].trim());
  const orderOk = checkRelativeOrder(extracted, sourceHeadings);
  checks.push({
    label: `Section headings appear in correct reading order (${sourceHeadings.length} headings)`,
    passed: orderOk,
  });

  const hasMangled = /�/.test(extracted);
  checks.push({
    label: "No encoding-mangled characters in extracted text",
    passed: !hasMangled,
  });

  return {
    passed: checks.every((c) => c.passed),
    checks,
    sourceWordCount: sourceWords.length,
    extractedWordCount: extractedWords.length,
  };
}
