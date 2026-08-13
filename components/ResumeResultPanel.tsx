"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResumeBlock,
  blocksToMarkdown,
  blocksToPlainText,
  parseResumeMarkdown,
} from "@/lib/resumeBlocks";
import { computeAtsScore } from "@/lib/atsScore";
import type { PdfValidationResult } from "@/lib/pdfValidate";
import { computeLayoutTier, type LayoutTier } from "@/lib/pdfBuilder";

export type PanelOutput = {
  company: string;
  roleTitle: string;
  adaptationNotes: string;
  tailoredResume: string;
  interviewQuestions: string[];
};

type ViewMode = "formatted" | "raw";

// PDF points -> on-screen CSS pixels at the 96 DPI this preview is sized
// for (matches the 816px-wide US Letter page below: 8.5in * 96 = 816).
const PT_TO_PX = 96 / 72;
// US Letter height (792pt) in that same 96 DPI — the preview page is fixed
// to this height so left-over space at the bottom is actually visible,
// instead of the container just shrink-wrapping to whatever the content's
// natural height happens to be.
const PAGE_HEIGHT_PX = 792 * PT_TO_PX;

// Generous fallback used until the real layout tier has been computed (or
// if that computation fails) — matches the spacious end of the PDF's own
// spacing range so the preview never looks worse than the eventual PDF.
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

// Always dark-on-light — this is standing in for a printed page, so it
// stays readable as black-on-white regardless of the site's dark mode.
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

export default function ResumeResultPanel({
  providerLabel,
  output,
  applyUrl,
  jobDescText,
}: {
  providerLabel: string;
  output: PanelOutput;
  applyUrl: string | null;
  jobDescText: string;
}) {
  const [blocks, setBlocks] = useState<ResumeBlock[]>(() =>
    parseResumeMarkdown(output.tailoredResume),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("formatted");
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [showInterviewModal, setShowInterviewModal] = useState(false);
  const [showAtsBreakdown, setShowAtsBreakdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string>("");
  const [verifyResult, setVerifyResult] = useState<PdfValidationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [showVerifyBreakdown, setShowVerifyBreakdown] = useState(false);
  const [layoutTier, setLayoutTier] = useState<LayoutTier>(FALLBACK_TIER);

  const atsResult = useMemo(
    () => computeAtsScore(blocks, jobDescText, output.company),
    [blocks, jobDescText, output.company],
  );

  useEffect(() => {
    setBlocks(parseResumeMarkdown(output.tailoredResume));
    setViewMode("formatted");
    setError(null);
    setVerifyResult(null);
    setShowVerifyBreakdown(false);
  }, [output]);

  // Recomputes the same spacing tier /api/pdf will pick for this exact
  // content, so the editable preview shows how full the exported PDF page
  // will actually be — not a fixed spacing unrelated to content length.
  // Debounced since this reruns on every keystroke while editing.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      computeLayoutTier({
        tailoredResume: blocksToMarkdown(blocks),
        // Browser text reflow wraps slightly more eagerly than pdf-lib's
        // own measurement even at matching font/size — bias toward a
        // tighter tier here so the preview reliably lands within one
        // visible page instead of spilling past it.
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
      const res = await fetch("/api/pdf", {
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
        throw new Error(errJson?.error ?? `Failed to generate PDF (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filenameMatch ? filenameMatch[1] : "Resume.pdf";
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
              {output.roleTitle} @ {output.company}
            </div>
            <button
              type="button"
              onClick={() => setShowAtsBreakdown((v) => !v)}
              className={
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold " +
                (atsResult.score >= 80
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : atsResult.score >= 60
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                    : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300")
              }
            >
              ATS {atsResult.score}/100 {showAtsBreakdown ? "▲" : "▼"}
            </button>

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
            Editable — proofread and make any small corrections before
            generating your PDF.
          </div>

          {showAtsBreakdown && (
            <ul className="mt-2 space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
              {atsResult.checks.map((c, i) => (
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

          {applyUrl && (
            <a
              href={applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-9 inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Apply here ↗
            </a>
          )}

          <button
            onClick={() => setShowInterviewModal(true)}
            className="h-9 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Interview Prep ({output.interviewQuestions.length})
          </button>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-indigo-50/60 px-6 py-4 dark:border-slate-800 dark:bg-indigo-950/20">
        <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
          How this was tailored to the job
        </div>
        <p className="mt-1 whitespace-pre-line text-sm text-indigo-950 dark:text-indigo-100">
          {output.adaptationNotes}
        </p>
      </div>

      <div className="p-6">
        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
            {error}
          </div>
        )}

        {!applyUrl && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            No apply link detected — pasted text doesn&apos;t carry links. Use the
            JD link field (or paste a URL along with the text) to get an
            &quot;Apply here&quot; shortcut next time.
          </div>
        )}

        {viewMode === "formatted" ? (
          // Sized and margined to mirror the actual exported PDF (US Letter,
          // 612x792pt at the same ~6.5% margins) so this is a real preview
          // of the page, not just a generically-wide text column. Always
          // rendered light/white — it's standing in for a printed page.
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

      {showInterviewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowInterviewModal(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Interview Prep — {providerLabel}
              </div>
              <button
                onClick={() => setShowInterviewModal(false)}
                className="h-8 w-8 rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-800 dark:text-slate-200">
              {output.interviewQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
