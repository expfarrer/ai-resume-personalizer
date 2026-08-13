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

// Content length varies a lot run to run (the prompt targets 550-750 words,
// hard-capped at 800, across anywhere from 1 to 7+ roles). A single fixed
// spacing either looks great on a typical resume and overflows onto a
// near-empty 2nd page for a dense one, or is tight enough to always fit one
// page but leaves a short resume looking cramped with visible dead space at
// the bottom. Instead we interpolate continuously between a spacious and a
// tight extreme and binary-search for the most generous point that still
// fits exactly on one page — so the page fills up as much as the content
// allows, and only genuinely dense resumes get compacted, no more than
// necessary. `computeLayoutTier` is also used client-side (see
// ResumeResultPanel) so the on-screen preview matches the exported PDF.
export type LayoutTier = {
  margin: number;
  headingSize: number;
  subheadingSize: number;
  bodySize: number;
  bulletSize: number;
  lineGap: number;
  headingPre: number; // extra gap before a major section heading
  subheadingPre: number; // extra gap before a role sub-heading
  blankGap: number; // gap for a blank line in the source markdown
};

const SPACIOUS_TIER: LayoutTier = {
  margin: 40,
  headingSize: 12.5,
  subheadingSize: 10.5,
  bodySize: 10,
  bulletSize: 10,
  lineGap: 2.5,
  headingPre: 4,
  subheadingPre: 2,
  // Close to a full line's height so a manually-inserted blank line reads
  // as an actual empty row, not a barely-visible nudge — a few points on
  // top of the line-height already applied after the preceding line was
  // basically invisible in practice.
  blankGap: 10,
};

const TIGHT_TIER: LayoutTier = {
  margin: 28,
  headingSize: 10.5,
  subheadingSize: 9.5,
  bodySize: 9,
  bulletSize: 9,
  lineGap: 1.3,
  headingPre: 2,
  subheadingPre: 0.5,
  blankGap: 4,
};

// t=0 -> TIGHT_TIER, t=1 -> SPACIOUS_TIER
function interpolateTier(t: number): LayoutTier {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    margin: lerp(TIGHT_TIER.margin, SPACIOUS_TIER.margin),
    headingSize: lerp(TIGHT_TIER.headingSize, SPACIOUS_TIER.headingSize),
    subheadingSize: lerp(TIGHT_TIER.subheadingSize, SPACIOUS_TIER.subheadingSize),
    bodySize: lerp(TIGHT_TIER.bodySize, SPACIOUS_TIER.bodySize),
    bulletSize: lerp(TIGHT_TIER.bulletSize, SPACIOUS_TIER.bulletSize),
    lineGap: lerp(TIGHT_TIER.lineGap, SPACIOUS_TIER.lineGap),
    headingPre: lerp(TIGHT_TIER.headingPre, SPACIOUS_TIER.headingPre),
    subheadingPre: lerp(TIGHT_TIER.subheadingPre, SPACIOUS_TIER.subheadingPre),
    blankGap: lerp(TIGHT_TIER.blankGap, SPACIOUS_TIER.blankGap),
  };
}

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
  " ": " ",
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

// Walks the same content the real draw pass will walk and sums up the
// vertical space it would consume, without touching a PDFPage. Used to pick
// the most generous layout tier that still fits on a single page.
function measureContentHeight(
  tailoredResume: string,
  regular: PDFFont,
  bold: PDFFont,
  tier: LayoutTier,
): number {
  const contentWidth = PAGE_WIDTH - tier.margin * 2;
  let used = 0;

  let previousWasBlank = true;
  for (const rawLine of tailoredResume.split("\n")) {
    const trimmedRaw = rawLine.trimEnd();

    if (trimmedRaw.trim().length === 0) {
      if (!previousWasBlank) used += tier.blankGap;
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
        used += tier.headingPre;
        used +=
          wrapLine(heading, bold, tier.headingSize, contentWidth).length *
          (tier.headingSize + tier.lineGap);
      } else {
        used += tier.subheadingPre;
        used +=
          wrapLine(heading, bold, tier.subheadingSize, contentWidth).length *
          (tier.subheadingSize + tier.lineGap);
      }
      continue;
    }

    const bulletMatch = trimmedRaw.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      const content = cleanLine(bulletMatch[1]);
      if (!content) continue;
      used +=
        wrapLine(content, regular, tier.bulletSize, contentWidth - 14).length *
        (tier.bulletSize + tier.lineGap);
      continue;
    }

    const paragraph = cleanLine(trimmedRaw);
    if (!paragraph) continue;
    used +=
      wrapLine(paragraph, regular, tier.bodySize, contentWidth).length *
      (tier.bodySize + tier.lineGap);
  }

  return used;
}

function chooseLayoutTier(
  tailoredResume: string,
  regular: PDFFont,
  bold: PDFFont,
  // Browser text reflow (used by the client-side editable preview) wraps
  // slightly differently than pdf-lib's own width-table-based wrapping,
  // even at matching font/size — small per-line differences compound over
  // a full resume into a real gap. The preview asks for a tighter budget
  // (< 1) to absorb that drift and still land inside one visible page.
  availableHeightFactor = 1,
): LayoutTier {
  const fits = (t: number) => {
    const tier = interpolateTier(t);
    const available = (PAGE_HEIGHT - tier.margin * 2) * availableHeightFactor;
    const needed = measureContentHeight(tailoredResume, regular, bold, tier);
    return needed <= available;
  };

  // Even the tightest spacing overflows (an unusually long resume) — use it
  // anyway and let the normal page-break logic below spill onto page 2
  // rather than compressing type past readability.
  if (!fits(0)) return interpolateTier(0);
  // Short resume — the spacious extreme already fits with room to spare.
  if (fits(1)) return interpolateTier(1);

  // Binary-search the most generous point on the spacious<->tight spectrum
  // that still lands on exactly one page, so the page fills up as much as
  // the content allows instead of jumping between a few fixed presets.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return interpolateTier(lo);
}

// Public entry point for computing the layout tier a given resume would
// get, without generating a full PDF — used by the client-side preview so
// its spacing matches what "Generate PDF" will actually produce.
export async function computeLayoutTier(params: {
  tailoredResume: string;
  availableHeightFactor?: number;
}): Promise<LayoutTier> {
  const { tailoredResume, availableHeightFactor = 1 } = params;
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return chooseLayoutTier(tailoredResume, regular, bold, availableHeightFactor);
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

  const tier = chooseLayoutTier(tailoredResume, regular, bold);
  const margin = tier.margin;
  const contentWidth = PAGE_WIDTH - margin * 2;

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - margin;

  function newPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - margin;
  }

  function ensureSpace(needed: number) {
    if (y - needed < margin) newPage();
  }

  function drawWrapped(
    text: string,
    font: PDFFont,
    size: number,
    color = rgb(0.1, 0.1, 0.12),
    indent = 0,
    lineGap = tier.lineGap,
  ) {
    const lines = wrapLine(text, font, size, contentWidth - indent);
    for (const line of lines) {
      ensureSpace(size + lineGap);
      page.drawText(line, {
        x: margin + indent,
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
      if (!previousWasBlank) y -= tier.blankGap;
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
        ensureSpace(tier.headingSize + tier.headingPre);
        y -= tier.headingPre;
        drawWrapped(heading, bold, tier.headingSize, rgb(0.05, 0.05, 0.08));
      } else {
        // Sub-heading — e.g. a single role's title | company - dates line
        ensureSpace(tier.subheadingSize + tier.subheadingPre);
        y -= tier.subheadingPre;
        drawWrapped(heading, bold, tier.subheadingSize, rgb(0.15, 0.15, 0.18));
      }
      continue;
    }

    const bulletMatch = trimmedRaw.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      const content = cleanLine(bulletMatch[1]);
      if (!content) continue;
      const bulletSize = tier.bulletSize;
      const lines = wrapLine(content, regular, bulletSize, contentWidth - 14);
      lines.forEach((l, i) => {
        ensureSpace(bulletSize + tier.lineGap);
        if (i === 0) {
          // "•" sits higher than the text baseline than letters do, so nudge
          // it up slightly to look vertically centered against the line.
          page.drawText("•", {
            x: margin + 2,
            y: y + 0.75,
            size: bulletSize,
            font: regular,
            color: rgb(0.1, 0.1, 0.12),
          });
        }
        page.drawText(l, {
          x: margin + 14,
          y,
          size: bulletSize,
          font: regular,
          color: rgb(0.1, 0.1, 0.12),
        });
        y -= bulletSize + tier.lineGap;
      });
      continue;
    }

    const paragraph = cleanLine(trimmedRaw);
    if (!paragraph) continue;
    drawWrapped(paragraph, regular, tier.bodySize);
  }

  return doc.save();
}
