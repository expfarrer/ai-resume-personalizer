// lib/atsNormalize.ts
// Post-processes model output for real-world ATS field-parsing quirks that
// our own text-layer/word-count validation (lib/pdfValidate.ts) doesn't
// catch, but a real ATS import does — confirmed against actual ATS import
// feedback on a generated resume:
//   - "Enter a valid format for Phone Number" — a "+1 774 477 4594" style
//     number (country code + space separators) failed the ATS's phone
//     validator. "(XXX) XXX-XXXX" is the most broadly-accepted US format.
//   - "Verify that ... First/Last Name ... contains more than 2 capital
//     letters" — an all-caps name ("THERESA CONIO", faithfully carried
//     over from the source resume's own stylized header) confuses the
//     ATS's name-field capitalization heuristic.
// Applied once at generation time (not at PDF-render time) so the editable
// preview is itself the source of truth — a user's own later edits are
// never silently rewritten by this.

function toTitleCaseIfAllCaps(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, "");
  // Leave short strings and anything not fully uppercase alone — this is
  // only meant to catch a stylized all-caps name, not "reformat" a name
  // that already has normal or intentional mixed capitalization.
  if (letters.length < 3 || letters !== letters.toUpperCase()) return name;
  return name
    .split(" ")
    .map((word) => (word.length === 0 ? word : word[0] + word.slice(1).toLowerCase()))
    .join(" ");
}

// Matches an optional US country code (+1 / 1) followed by a 10-digit
// number in any common separator style ("(XXX) XXX-XXXX", "XXX-XXX-XXXX",
// "XXX.XXX.XXXX", "XXX XXX XXXX", "XXXXXXXXXX", with or without a leading
// "+1"/"1"), and reformats it to "(XXX) XXX-XXXX".
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;

function normalizePhoneNumbers(text: string): string {
  return text.replace(PHONE_RE, (_match, area, prefix, line) => `(${area}) ${prefix}-${line}`);
}

export function normalizeForAts(tailoredResume: string): string {
  const lines = tailoredResume.split("\n");

  // Name line: the first non-blank line, which per the prompt's own
  // formatting rules is always the candidate's name alone (never a "#"
  // section heading — those never appear before it).
  const nameIdx = lines.findIndex((l) => l.trim().length > 0);
  if (nameIdx !== -1 && !/^#{1,3}\s/.test(lines[nameIdx])) {
    lines[nameIdx] = toTitleCaseIfAllCaps(lines[nameIdx]);
  }

  // Phone number: only normalize within the header block (before the first
  // section heading) to avoid touching unrelated digit sequences elsewhere
  // in the resume body (metrics, dates, etc.).
  const firstHeadingIdx = lines.findIndex((l) => /^#{1,3}\s/.test(l));
  const headerEnd = firstHeadingIdx === -1 ? lines.length : firstHeadingIdx;
  for (let i = 0; i < headerEnd; i++) {
    lines[i] = normalizePhoneNumbers(lines[i]);
  }

  return lines.join("\n");
}
