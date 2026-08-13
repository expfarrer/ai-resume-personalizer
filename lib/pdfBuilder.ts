// lib/pdfBuilder.ts
// Renders a tailored-resume markdown-ish string into a simple, single-column,
// selectable-text PDF using pdf-lib (pure JS, no headless browser). Layout
// and character handling are deliberately conservative for ATS parsers:
// plain flowing text top-to-bottom, standard base font, no tables/columns/
// images, and every character sanitized to something the embedded font can
// actually encode (unrecognized glyphs would otherwise throw at render time).

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Common "smart" typography a model tends to produce, mapped to plain ASCII
// that's both guaranteed encodable by the standard WinAnsi font and safer
// for ATS keyword/section parsing than decorative punctuation.
const CHAR_REPLACEMENTS: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": ",",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "…": "...",
  " ": " ",
  "•": "-",
  "‣": "-",
  "⁃": "-",
  "●": "-",
  "▪": "-",
  "◦": "-",
  "→": "->",
  "←": "<-",
  "✓": "x",
  "✔": "x",
  "✗": "x",
  "®": "(R)",
  "™": "(TM)",
  "©": "(C)",
};

const CHAR_REPLACEMENT_RE = new RegExp(
  `[${Object.keys(CHAR_REPLACEMENTS).join("")}]`,
  "g",
);

function sanitizeForPdf(text: string): string {
  let out = text.replace(CHAR_REPLACEMENT_RE, (ch) => CHAR_REPLACEMENTS[ch]);
  // Last-resort safety net: the embedded standard font only encodes Latin-1
  // (WinAnsi) — anything else (emoji, non-Latin scripts, stray symbols)
  // would throw at drawText time, so replace rather than crash PDF export.
  out = out.replace(/[^\x00-\xFF]/g, "?");
  return out;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, "$1")
    .replace(/`(.+?)`/g, "$1");
}

function cleanLine(text: string): string {
  return sanitizeForPdf(stripInlineMarkdown(text)).replace(/\s+/g, " ").trim();
}

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export function buildResumeFilename(company: string, roleTitle: string): string {
  const sanitize = (s: string) =>
    (s ?? "")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);

  const parts = [sanitize(company), sanitize(roleTitle)].filter(Boolean);
  if (parts.length === 0) return "Resume.pdf";
  return `${parts.join(" - ")} - Resume.pdf`;
}

// HTTP headers are ByteString (Latin-1) only — a filename with e.g. curly
// quotes or non-Latin characters would throw when set directly as
// `Content-Disposition: filename="..."`. This produces a plain-ASCII
// fallback (transliterating accents where possible); pair it with an
// RFC 5987 `filename*=UTF-8''...` param for full-fidelity Unicode in
// browsers that support it (all modern ones do).
export function buildAsciiFilename(filename: string): string {
  const ascii = filename
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .trim();
  return ascii || "Resume.pdf";
}

export async function buildResumePdf(params: {
  company: string;
  roleTitle: string;
  tailoredResume: string;
}): Promise<Uint8Array> {
  const { company, roleTitle, tailoredResume } = params;

  const doc = await PDFDocument.create();
  doc.setTitle(sanitizeForPdf(`${roleTitle} - ${company} - Resume`));
  doc.setSubject("Tailored resume");
  doc.setProducer("AI Resume Personalizer");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function newPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) newPage();
  }

  function drawWrapped(
    text: string,
    font: PDFFont,
    size: number,
    color = rgb(0.1, 0.1, 0.12),
    indent = 0,
    lineGap = 2.5,
  ) {
    const lines = wrapLine(text, font, size, CONTENT_WIDTH - indent);
    for (const line of lines) {
      ensureSpace(size + lineGap);
      page.drawText(line, {
        x: MARGIN + indent,
        y,
        size,
        font,
        color,
      });
      y -= size + lineGap;
    }
  }

  const rawLines = tailoredResume.split("\n");
  let previousWasBlank = true; // suppress a leading gap at the very top of the page

  for (const rawLine of rawLines) {
    const trimmedRaw = rawLine.trimEnd();

    if (trimmedRaw.trim().length === 0) {
      if (!previousWasBlank) y -= 4;
      previousWasBlank = true;
      continue;
    }
    previousWasBlank = false;

    const headingMatch = trimmedRaw.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = cleanLine(headingMatch[2]);
      if (!heading) continue;
      if (level <= 2) {
        // Major section heading (Technical Skills, Experience, ...)
        ensureSpace(18);
        y -= 4;
        drawWrapped(heading, bold, 12.5, rgb(0.05, 0.05, 0.08));
      } else {
        // Sub-heading — e.g. a single role's title | company - dates line
        ensureSpace(14);
        y -= 2;
        drawWrapped(heading, bold, 10.5, rgb(0.15, 0.15, 0.18));
      }
      continue;
    }

    const bulletMatch = trimmedRaw.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      const content = cleanLine(bulletMatch[1]);
      if (!content) continue;
      const bulletSize = 10;
      const lines = wrapLine(content, regular, bulletSize, CONTENT_WIDTH - 14);
      lines.forEach((l, i) => {
        ensureSpace(bulletSize + 2.5);
        if (i === 0) {
          // "•" sits higher than the text baseline than letters do, so nudge
          // it up slightly to look vertically centered against the line.
          page.drawText("•", {
            x: MARGIN + 2,
            y: y + 0.75,
            size: bulletSize,
            font: regular,
            color: rgb(0.1, 0.1, 0.12),
          });
        }
        page.drawText(l, {
          x: MARGIN + 14,
          y,
          size: bulletSize,
          font: regular,
          color: rgb(0.1, 0.1, 0.12),
        });
        y -= bulletSize + 2.5;
      });
      continue;
    }

    const paragraph = cleanLine(trimmedRaw);
    if (!paragraph) continue;
    drawWrapped(paragraph, regular, 10);
  }

  return doc.save();
}
