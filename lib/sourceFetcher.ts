// lib/sourceFetcher.ts
// Resolves job-description / resume inputs supplied as URLs (rather than
// pasted text) into plain text, handling PDF share links (Dropbox, Google
// Drive) and best-effort HTML scraping, with detection of bot-blocked pages
// (e.g. LinkedIn/Glassdoor) so callers can fall back to manual paste.

import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const BLOCKED_SIGNAL_RE =
  /captcha|verify you are human|unusual traffic|access denied|are you a robot|enable javascript and cookies|security check/i;

export class FetchBlockedError extends Error {
  constructor(url: string) {
    super(
      `The page at ${url} couldn't be read automatically (it appears to require a login or blocks automated access). Paste the text instead.`,
    );
    this.name = "FetchBlockedError";
  }
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)"'<>]+/i);
  return match ? match[0] : null;
}

export function resolveDirectUrl(rawUrl: string): string {
  const url = new URL(rawUrl);

  if (url.hostname.includes("dropbox.com")) {
    url.searchParams.set("dl", "1");
    return url.toString();
  }

  if (url.hostname.includes("drive.google.com")) {
    const match = url.pathname.match(/\/file\/d\/([^/]+)/);
    const id = match?.[1] ?? url.searchParams.get("id");
    if (id) {
      return `https://drive.google.com/uc?export=download&id=${id}`;
    }
  }

  return rawUrl;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export async function extractPdfBuffer(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}

// .docx only (Office Open XML) — legacy binary .doc is a different format
// mammoth doesn't support; callers should reject those before calling this.
export async function extractDocxBuffer(buf: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value.trim();
}

export async function fetchTextFromUrl(
  rawUrl: string,
): Promise<{ text: string; kind: "pdf" | "html" }> {
  const directUrl = resolveDirectUrl(rawUrl);

  const res = await fetch(directUrl, {
    redirect: "follow",
    headers: { "User-Agent": BROWSER_USER_AGENT },
  });

  if (res.status === 403 || res.status === 429 || res.status === 999) {
    throw new FetchBlockedError(rawUrl);
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch ${rawUrl}: HTTP ${res.status}`);
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  const isPdf =
    contentType.includes("application/pdf") ||
    buf.subarray(0, 5).toString("latin1") === "%PDF-";

  if (isPdf) {
    const text = await extractPdfBuffer(buf);
    if (text.length < 20) throw new FetchBlockedError(rawUrl);
    return { text, kind: "pdf" };
  }

  const html = buf.toString("utf-8");
  if (BLOCKED_SIGNAL_RE.test(html)) {
    throw new FetchBlockedError(rawUrl);
  }

  const text = htmlToText(html);
  if (text.length < 200) {
    throw new FetchBlockedError(rawUrl);
  }

  return { text, kind: "html" };
}
