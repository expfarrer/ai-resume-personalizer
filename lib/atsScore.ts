// lib/atsScore.ts
// A deterministic, rules-based ATS readability score (0-100) for a tailored
// resume, computed purely from its own structure/content — no extra model
// call. Rules-based scoring is used deliberately here instead of asking an
// LLM to grade itself: it's explainable (every point is traceable to a
// concrete check), free, instant, and directly comparable across providers.

import { ResumeBlock, blocksToPlainText } from "./resumeBlocks";

export type AtsCheck = {
  label: string;
  passed: boolean;
};

export type AtsScoreResult = {
  score: number;
  checks: AtsCheck[];
};

const STOPWORDS = new Set([
  "about","above","after","again","against","all","also","among","an","and","any",
  "are","aren","as","at","because","been","before","being","below","between","both",
  "but","by","can","cannot","could","did","does","doing","down","during","each","few",
  "for","from","further","had","has","have","having","here","how","into","its","itself",
  "just","more","most","not","now","only","other","our","ours","out","over","own","same",
  "should","some","such","than","that","the","their","theirs","them","then","there",
  "these","they","this","those","through","under","until","very","was","were","what",
  "when","where","which","while","who","whom","why","will","with","would","you","your",
  "yours","across","within","upon","per","etc","including","required","preferred",
  "years","year","experience","ability","strong","work","working","role","team",
  "company","companies","systems","solutions","group","drive","driving","deliver",
  "delivering","own","owning","lead","leading","build","building","looking",
  "seeking","join","joining","help","helping","make","making","using","use",
  "location","locations","posted","full","time","apply","description","job",
  "position","opportunity","great","excellent","new","need","needs","needed",
]);

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    // Strip leading/trailing punctuation (e.g. a sentence-ending period
    // stuck to the last word) while keeping meaningful internal punctuation
    // intact so terms like "Node.js" or "C++" survive as single tokens.
    .map((w) => w.trim().replace(/^[.+#-]+|[.+#-]+$/g, ""))
    .filter((w) => w.length > 4 && !STOPWORDS.has(w));
  return Array.from(new Set(words));
}

export function computeAtsScore(
  blocks: ResumeBlock[],
  jobDescText: string,
  companyName = "",
): AtsScoreResult {
  const companyWords = new Set(
    companyName
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter(Boolean),
  );
  const nonBlank = blocks.filter(
    (b): b is Exclude<ResumeBlock, { type: "blank" }> => b.type !== "blank",
  );
  const headingTexts = blocks
    .filter((b) => b.type === "heading")
    .map((b) => b.text.toLowerCase());
  const bullets = blocks.filter((b) => b.type === "bullet");
  const subHeadings = blocks.filter(
    (b): b is Extract<ResumeBlock, { type: "heading" }> =>
      b.type === "heading" && b.level >= 3,
  );
  const plain = blocksToPlainText(blocks).toLowerCase();

  const checks: AtsCheck[] = [];
  const weights = {
    contact: 10,
    headings: 20,
    bullets: 10,
    structure: 10,
    plainText: 10,
    length: 10,
    dates: 10,
    keywords: 20,
  };
  let earned = 0;
  let possible = 0;

  // 1. Contact info near the top
  const topText = nonBlank.slice(0, 3).map((b) => b.text).join(" ");
  const hasEmail = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(topText);
  const hasPhone = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(topText);
  const contactOk = hasEmail || hasPhone;
  checks.push({ label: "Contact info (email/phone) near the top", passed: contactOk });
  earned += contactOk ? weights.contact : 0;
  possible += weights.contact;

  // 2. Standard, ATS-recognized section headings
  const coreHeadings = ["summary", "experience", "skills", "education"];
  const foundHeadings = coreHeadings.filter((h) =>
    headingTexts.some((x) => x.includes(h)),
  );
  checks.push({
    label: `Standard section headings (${foundHeadings.length}/4: Summary, Experience, Skills, Education)`,
    passed: foundHeadings.length >= 3,
  });
  earned += (foundHeadings.length / coreHeadings.length) * weights.headings;
  possible += weights.headings;

  // 3. Bullet points used for experience
  const bulletsOk = bullets.length >= 3;
  checks.push({ label: "Bullet points used for experience", passed: bulletsOk });
  earned += bulletsOk ? weights.bullets : 0;
  possible += weights.bullets;

  // 4. Single-column, no tables/images (structurally guaranteed by this app's renderer)
  checks.push({ label: "Single-column layout, no tables or images", passed: true });
  earned += weights.structure;
  possible += weights.structure;

  // 5. Plain ASCII text — no decorative symbols/emoji that could confuse a parser
  const hasDecorative = /[^\x00-\x7F]/.test(
    nonBlank.map((b) => b.text).join(" "),
  );
  checks.push({ label: "Plain ASCII text (no special symbols/emoji)", passed: !hasDecorative });
  earned += hasDecorative ? 0 : weights.plainText;
  possible += weights.plainText;

  // 6. Reasonable length for 1-2 printed pages
  const wordCount = plain.split(/\s+/).filter(Boolean).length;
  const lengthOk = wordCount > 0 && wordCount <= 800;
  checks.push({
    label: `Reasonable length for 1-2 pages (${wordCount} words)`,
    passed: lengthOk,
  });
  earned += lengthOk ? weights.length : 0;
  possible += weights.length;

  // 7. Consistent, parseable dates on experience entries
  const datePattern = /\b(19|20)\d{2}\b|present/i;
  const datedCount = subHeadings.filter((b) => datePattern.test(b.text)).length;
  const datesOk = subHeadings.length === 0 || datedCount === subHeadings.length;
  checks.push({ label: "Consistent dates on experience entries", passed: datesOk });
  earned += datesOk ? weights.dates : 0;
  possible += weights.dates;

  // 8. Keyword overlap with the job description — the most job-specific signal
  const jdKeywords = jobDescText
    ? extractKeywords(jobDescText).filter((k) => !companyWords.has(k))
    : [];
  if (jdKeywords.length > 0) {
    const matched = jdKeywords.filter((k) => plain.includes(k));
    const missing = jdKeywords.filter((k) => !plain.includes(k));
    const fraction = matched.length / jdKeywords.length;
    const missingNote =
      missing.length > 0
        ? ` — missing: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", …" : ""}`
        : "";
    checks.push({
      label: `Keyword overlap with job description (${matched.length}/${jdKeywords.length} key terms, ${Math.round(fraction * 100)}%)${missingNote}`,
      passed: fraction >= 0.5,
    });
    earned += fraction * weights.keywords;
    possible += weights.keywords;
  }

  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  return { score, checks };
}
