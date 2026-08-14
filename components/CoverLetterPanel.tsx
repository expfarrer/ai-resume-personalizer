"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ResumeBlock,
  blocksToMarkdown,
  blocksToPlainText,
  parseResumeMarkdown,
} from "@/lib/resumeBlocks";
import type { PdfValidationResult } from "@/lib/pdfValidate";
import { computeLayoutTier, type LayoutTier } from "@/lib/pdfBuilder";
import type { PanelOutput } from "./ResumeResultPanel";

// Same editable-blocks pattern as ResumeResultPanel (parse -> editable
// blocks -> serialize for PDF/plain-text), reused verbatim: a cover letter
// is just body-paragraph markdown with no headings/bullets, which
// lib/resumeBlocks.ts already handles generically. Kept as a self-contained
// sibling component (some duplication of the small shared bits below)
// rather than a shared abstraction, since the two panels' toolbars differ
// (ATS score/Interview Prep are resume-only) and would need to fork anyway.

const PT_TO_PX = 96 / 72;
const PAGE_HEIGHT_PX = 792 * PT_TO_PX;

const FALLBACK_TIER: LayoutTier = {
  margin: 40,
  headingSize: 12.5,
  subheadingSize: 10.5,
  bodySize: 10,
  bulletSize: 10,
  lineGap: 2.5,
  headingPre: 4,
  subheadingPre: 2,
  blankGap: 4,
};

const editableFieldClass =
  "w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-slate-900 focus:outline-none focus:ring-0 focus:bg-indigo-50/70";

function AutoGrowTextarea({
  value,
  onChange,
  className,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value, style?.fontSize, style?.lineHeight]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={className}
      style={style}
    />
  );
}

type ViewMode = "formatted" | "raw";

export default function CoverLetterPanel({
  providerLabel,
  output,
  coverLetter,
}: {
  providerLabel: string;
  output: Pick<PanelOutput, "company" | "roleTitle">;
  coverLetter: string;
}) {
  const [blocks, setBlocks] = useState<ResumeBlock[]>(() =>
    parseResumeMarkdown(coverLetter),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("formatted");
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string>("");
  const [verifyResult, setVerifyResult] = useState<PdfValidationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [showVerifyBreakdown, setShowVerifyBreakdown] = useState(false);
  const [layoutTier, setLayoutTier] = useState<LayoutTier>(FALLBACK_TIER);

  useEffect(() => {
    setBlocks(parseResumeMarkdown(coverLetter));
    setViewMode("formatted");
    setError(null);
    setVerifyResult(null);
    setShowVerifyBreakdown(false);
  }, [coverLetter]);

  // Same adaptive-spacing tier computation as the resume preview, so the
  // cover letter's editable page shows how full the exported PDF will
  // actually be. Debounced since it reruns on every keystroke while editing.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      computeLayoutTier({
        tailoredResume: blocksToMarkdown(blocks),
        availableHeightFactor: 0.84,
      })
        .then(setLayoutTier)
        .catch(() => setLayoutTier(FALLBACK_TIER));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [blocks]);

  function setStatusTemp(msg: string) {
    setCopyStatus(msg);
    window.setTimeout(() => setCopyStatus(""), 1500);
  }

  async function copyText(label: string, text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setStatusTemp(`${label} copied`);
        return;
      }
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "true");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setStatusTemp(`${label} copied`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "permission denied";
      setStatusTemp(`Copy failed: ${message}`);
    }
  }

  function updateBlockText(id: string, text: string) {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id && b.type !== "blank" ? { ...b, text } : b)),
    );
  }

  async function generatePdf() {
    setPdfGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/coverletter/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: output.company,
          roleTitle: output.roleTitle,
          coverLetter: blocksToMarkdown(blocks),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error ?? `Failed to generate PDF (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filenameMatch ? filenameMatch[1] : "Cover Letter.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate PDF");
    } finally {
      setPdfGenerating(false);
    }
  }

  async function verifyPdf() {
    setVerifying(true);
    setError(null);
    try {
      // Reuses the same independent-extraction validator as the resume —
      // it's already generic (company/roleTitle/tailoredResume in, pass/fail
      // checks out), so no cover-letter-specific endpoint is needed.
      const res = await fetch("/api/pdf/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: output.company,
          roleTitle: output.roleTitle,
          tailoredResume: blocksToMarkdown(blocks),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error ?? `Failed to verify PDF (HTTP ${res.status})`);
      }

      const result = (await res.json()) as PdfValidationResult;
      setVerifyResult(result);
      setShowVerifyBreakdown(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to verify PDF extraction");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5 dark:border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-bold text-white dark:bg-slate-100 dark:text-black">
              {providerLabel}
            </span>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Cover Letter — {output.roleTitle} @ {output.company}
            </div>

            {verifyResult ? (
              <button
                type="button"
                onClick={() => setShowVerifyBreakdown((v) => !v)}
                className={
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold " +
                  (verifyResult.passed
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300")
                }
              >
                Extraction {verifyResult.passed ? "✓ verified" : "✗ issues"}{" "}
                {showVerifyBreakdown ? "▲" : "▼"}
              </button>
            ) : (
              <button
                type="button"
                onClick={verifyPdf}
                disabled={verifying}
                className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {verifying ? "Verifying…" : "Verify Extraction"}
              </button>
            )}
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-300">
            Editable — proofread before generating your PDF.
          </div>

          {verifyResult && showVerifyBreakdown && (
            <ul className="mt-2 space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
              <li className="text-slate-500 dark:text-slate-400">
                Independent re-extraction — regenerates the PDF and parses it
                back with a separate library, checking what a real ATS
                parser would actually see.
              </li>
              {verifyResult.checks.map((c, i) => (
                <li
                  key={i}
                  className={
                    "flex items-start gap-1.5 " +
                    (c.passed
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-rose-700 dark:text-rose-400")
                  }
                >
                  <span>{c.passed ? "✓" : "✗"}</span>
                  <span className="text-slate-700 dark:text-slate-300">{c.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setViewMode("formatted")}
              className={
                "px-3 text-xs font-semibold " +
                (viewMode === "formatted"
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-black"
                  : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800")
              }
            >
              Formatted (edit)
            </button>
            <button
              type="button"
              onClick={() => setViewMode("raw")}
              className={
                "px-3 text-xs font-semibold " +
                (viewMode === "raw"
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-black"
                  : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800")
              }
            >
              Raw (copy/paste)
            </button>
          </div>

          <button
            onClick={generatePdf}
            disabled={pdfGenerating}
            className="h-9 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pdfGenerating ? "Generating PDF…" : "Generate PDF"}
          </button>

          <button
            onClick={() => copyText("Plain text", blocksToPlainText(blocks))}
            className="h-9 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Copy Plain Text
          </button>
        </div>
      </div>

      <div className="p-6">
        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
            {error}
          </div>
        )}

        {viewMode === "formatted" ? (
          <div className="flex justify-center overflow-x-auto rounded-2xl bg-slate-200 p-4 dark:bg-slate-950 sm:p-8">
            <div
              className="shrink-0 bg-white text-slate-900 shadow-lg"
              style={{
                width: 816,
                minHeight: PAGE_HEIGHT_PX,
                padding: layoutTier.margin * PT_TO_PX,
              }}
            >
              <div>
                {blocks.map((b) => {
                  if (b.type === "blank") {
                    return (
                      <div key={b.id} style={{ height: layoutTier.blankGap * PT_TO_PX }} />
                    );
                  }
                  if (b.type === "heading") {
                    const isMajor = b.level <= 2;
                    const sizePt = isMajor ? layoutTier.headingSize : layoutTier.subheadingSize;
                    const prePt = isMajor ? layoutTier.headingPre : layoutTier.subheadingPre;
                    return (
                      <AutoGrowTextarea
                        key={b.id}
                        value={b.text}
                        onChange={(v) => updateBlockText(b.id, v)}
                        style={{
                          marginTop: prePt * PT_TO_PX,
                          fontSize: sizePt * PT_TO_PX,
                          lineHeight: `${(sizePt + layoutTier.lineGap) * PT_TO_PX}px`,
                        }}
                        className={
                          isMajor
                            ? "w-full resize-none overflow-hidden border-0 bg-transparent font-bold text-slate-900 focus:outline-none focus:bg-indigo-50/70"
                            : "w-full resize-none overflow-hidden border-0 bg-transparent font-semibold text-slate-800 focus:outline-none focus:bg-indigo-50/70"
                        }
                      />
                    );
                  }
                  const sizePt = b.type === "bullet" ? layoutTier.bulletSize : layoutTier.bodySize;
                  const lineHeightPx = (sizePt + layoutTier.lineGap) * PT_TO_PX;
                  if (b.type === "bullet") {
                    return (
                      <div key={b.id} className="flex items-start gap-2">
                        <span
                          className="text-slate-500"
                          style={{ fontSize: sizePt * PT_TO_PX, lineHeight: `${lineHeightPx}px` }}
                        >
                          •
                        </span>
                        <AutoGrowTextarea
                          value={b.text}
                          onChange={(v) => updateBlockText(b.id, v)}
                          className={editableFieldClass}
                          style={{ fontSize: sizePt * PT_TO_PX, lineHeight: `${lineHeightPx}px` }}
                        />
                      </div>
                    );
                  }
                  return (
                    <AutoGrowTextarea
                      key={b.id}
                      value={b.text}
                      onChange={(v) => updateBlockText(b.id, v)}
                      className={editableFieldClass}
                      style={{ fontSize: sizePt * PT_TO_PX, lineHeight: `${lineHeightPx}px` }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <textarea
            readOnly
            value={blocksToPlainText(blocks)}
            rows={18}
            className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-900 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
          />
        )}

        {copyStatus && (
          <div className="mt-3 inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {copyStatus}
          </div>
        )}
      </div>
    </div>
  );
}
