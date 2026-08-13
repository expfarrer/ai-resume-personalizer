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
    fullName: 5,
    contact: 10,
    streetAddress: 5,
    cityStateZip: 5,
    headings: 20,
    jobTitlePattern: 5,
    educationPattern: 5,
    bullets: 10,
    structure: 10,
    plainText: 10,
    length: 10,
    dates: 10,
    keywords: 20,
  };
  let earned = 0;
  let possible = 0;

  // 1. Full name on its own line at the very top — an ATS that can't find a
  // clean name line can't populate its own "First/Last Name" fields at all.
  const firstLine = (nonBlank[0]?.text ?? "").trim();
  const looksLikeName =
    /^[A-Z][a-zA-Z.'-]+(\s+[A-Z][a-zA-Z.'-]+){1,3}$/.test(firstLine) &&
    !/[@\d]/.test(firstLine);
  checks.push({ label: "Full name on its own line at the top", passed: looksLikeName });
  earned += looksLikeName ? weights.fullName : 0;
  possible += weights.fullName;

  // 2. Contact info near the top
  const topText = nonBlank.slice(0, 4).map((b) => b.text).join(" ");
  const hasEmail = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(topText);
  const hasPhone = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(topText);
  const contactOk = hasEmail || hasPhone;
  checks.push({ label: "Contact info (email/phone) near the top", passed: contactOk });
  earned += contactOk ? weights.contact : 0;
  possible += weights.contact;

  // 2b/2c. Complete mailing address — many ATS systems auto-fill an
  // applicant's address fields straight from the resume header and reject
  // or flag it when all that's there is a region ("Greater Boston Area")
  // instead of an actual street + city + state + ZIP. Confirmed against
  // real ATS import feedback, not a theoretical rule.
  const US_STATE_ABBR =
    "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
  const hasStreetAddress = /\b\d{1,6}\s+[A-Za-z][A-Za-z0-9.'-]*(\s+[A-Za-z0-9.'-]+){0,4}\b/.test(
    topText,
  );
  checks.push({
    label: hasStreetAddress
      ? "Street address present"
      : 'Street address missing — a region like "Greater Boston Area" alone can leave an ATS\'s street-address field empty',
    passed: hasStreetAddress,
  });
  earned += hasStreetAddress ? weights.streetAddress : 0;
  possible += weights.streetAddress;

  const hasCityStateZip = new RegExp(
    `[A-Za-z][A-Za-z .'-]*,\\s*(${US_STATE_ABBR})\\b\\s*\\d{5}(-\\d{4})?`,
  ).test(topText);
  checks.push({
    label: hasCityStateZip
      ? "City, state, and ZIP present"
      : "City/state/ZIP not detected in \"City, ST 00000\" format — needed for an ATS to parse location fields",
    passed: hasCityStateZip,
  });
  earned += hasCityStateZip ? weights.cityStateZip : 0;
  possible += weights.cityStateZip;

  // 3. Standard, ATS-recognized section headings
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

  // 3b. Job title clearly separated from company on each Experience entry —
  // an ATS title-parser can fail on "Title | Location - Dates" with no
  // distinct company/employer segment (freelance/self-employed roles are
  // the usual culprit). Confirmed against real ATS import feedback.
  const SELF_EMPLOYED_RE = /\b(self-employed|freelance|independent contractor|independent consultant)\b/i;
  const incompleteRoles = subHeadings.filter((b) => {
    const parts = b.text.split("|");
    if (parts.length < 2) return true;
    const rest = parts.slice(1).join("|");
    return !rest.includes(",") && !SELF_EMPLOYED_RE.test(rest);
  });
  const rolesOk = subHeadings.length === 0 || incompleteRoles.length === 0;
  checks.push({
    label: rolesOk
      ? "Job title clearly separated from company on each experience entry"
      : `Job title/company pattern unclear on ${incompleteRoles.length} experience ${incompleteRoles.length === 1 ? "entry" : "entries"} (e.g. "${incompleteRoles[0]?.text}") — an ATS can fail to extract a job title with no distinct company name; freelance/self-employed roles need "Self-Employed" or "Freelance" filled in as the company`,
    passed: rolesOk,
  });
  earned += rolesOk ? weights.jobTitlePattern : 0;
  possible += weights.jobTitlePattern;

  // 3c. Degree clearly separated from institution in Education — same class
  // of ATS parsing failure as job titles, just for "Degree" / "School"
  // fields instead of "Job Title" / "Company".
  const eduHeadingIdx = blocks.findIndex(
    (b) => b.type === "heading" && b.level <= 2 && /education/i.test(b.text),
  );
  const eduLines: Extract<ResumeBlock, { type: "paragraph" | "bullet" }>[] = [];
  if (eduHeadingIdx !== -1) {
    for (let i = eduHeadingIdx + 1; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === "heading" && b.level <= 2) break;
      if (b.type === "paragraph" || b.type === "bullet") eduLines.push(b);
    }
  }
  const DEGREE_RE =
    /\b(b\.?a\.?|b\.?s\.?|b\.?sc\.?|bachelor|master|m\.?a\.?|m\.?s\.?|m\.?sc\.?|mba|ph\.?d\.?|doctorate|associate|diploma|certificate)\b/i;
  const incompleteEdu = eduLines.filter(
    (b) => !(DEGREE_RE.test(b.text) && b.text.includes("|")),
  );
  const eduOk = eduLines.length === 0 || incompleteEdu.length === 0;
  checks.push({
    label: eduOk
      ? "Degree clearly separated from institution in Education"
      : `Degree/institution pattern unclear on ${incompleteEdu.length} Education ${incompleteEdu.length === 1 ? "line" : "lines"} (e.g. "${incompleteEdu[0]?.text}") — expected "Degree | Institution, Location - Year" so an ATS can split degree from school`,
    passed: eduOk,
  });
  earned += eduOk ? weights.educationPattern : 0;
  possible += weights.educationPattern;

  // 3d. Bullet points used for experience
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
