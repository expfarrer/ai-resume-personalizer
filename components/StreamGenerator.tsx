"use client";

import React, { useEffect, useRef, useState } from "react";
import ResumeResultPanel, { PanelOutput } from "./ResumeResultPanel";

type Output = PanelOutput;

type Provider = "openai" | "claude";

const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "ChatGPT",
  claude: "Claude",
};

type ProviderResult = { output: Output; applyUrl: string | null; jobDescText: string };

type HistoryItem = {
  id: string;
  createdAt: string;
  jobDesc: string;
  experience: string;
  resultJson: string;
  applyUrl: string | null;
  specialInstructions: string | null;
};

const SAVED_RESUME_KEY = "arp:savedResume";
const SPECIAL_INSTRUCTIONS_KEY = "arp:specialInstructions";

type SavedResume = { text: string; name: string; savedAt: string };

function isSavedResume(x: unknown): x is SavedResume {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.text === "string" &&
    typeof r.name === "string" &&
    typeof r.savedAt === "string"
  );
}

function isOutput(x: unknown): x is Output {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.adaptationNotes === "string" &&
    typeof r.tailoredResume === "string" &&
    Array.isArray(r.interviewQuestions)
  );
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function previewText(s: string, n = 56) {
  const oneLine = (s ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n) + "…" : oneLine;
}

export default function StreamGenerator() {
  const [useOpenAI, setUseOpenAI] = useState(true);
  const [useClaude, setUseClaude] = useState(false);

  const [jobUrl, setJobUrl] = useState("");
  const [jobText, setJobText] = useState("");
  const [showJobUrlField, setShowJobUrlField] = useState(false);

  const [resumeUrl, setResumeUrl] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [showResumeAlt, setShowResumeAlt] = useState(false);
  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);

  const [specialInstructions, setSpecialInstructions] = useState("");

  const [savedResume, setSavedResume] = useState<SavedResume | null>(null);

  const [loading, setLoading] = useState(false);

  const [results, setResults] = useState<Partial<Record<Provider, ProviderResult>>>({});
  const [resultErrors, setResultErrors] = useState<Partial<Record<Provider, string>>>({});
  const [historyResult, setHistoryResult] = useState<ProviderResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<string>("—");
  const [contentType, setContentType] = useState<string>("—");

  // History
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);

  const jobReady = jobText.trim().length > 0 || jobUrl.trim().length > 0;
  const hasNewResumeInput =
    resumeUrl.trim().length > 0 || !!resumeFile || resumeText.trim().length > 0;
  const willUseSavedResume = !hasNewResumeInput && !!savedResume;
  const resumeReady = hasNewResumeInput || willUseSavedResume;
  const anyProviderSelected = useOpenAI || useClaude;

  const canRun = jobReady && resumeReady && anyProviderSelected;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SAVED_RESUME_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (isSavedResume(parsed)) setSavedResume(parsed);
      }
    } catch {
      // localStorage unavailable, or a stale value from a previous format —
      // saved-resume reuse simply won't work until a fresh run saves one.
    }

    try {
      const storedInstructions = window.localStorage.getItem(
        SPECIAL_INSTRUCTIONS_KEY,
      );
      if (storedInstructions) setSpecialInstructions(storedInstructions);
    } catch {
      // localStorage unavailable — special instructions won't persist.
    }
  }, []);

  function persistSavedResume(next: SavedResume) {
    setSavedResume(next);
    try {
      window.localStorage.setItem(SAVED_RESUME_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function updateSpecialInstructions(next: string) {
    setSpecialInstructions(next);
    try {
      if (next.trim()) {
        window.localStorage.setItem(SPECIAL_INSTRUCTIONS_KEY, next);
      } else {
        window.localStorage.removeItem(SPECIAL_INSTRUCTIONS_KEY);
      }
    } catch {
      // ignore
    }
  }

  function stop() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
  }

  function clearAll() {
    setJobUrl("");
    setJobText("");
    setShowJobUrlField(false);
    setResumeUrl("");
    setResumeFile(null);
    if (resumeFileInputRef.current) resumeFileInputRef.current.value = "";
    setResumeText("");
    setShowResumeAlt(false);
    setSpecialInstructions("");
    try {
      window.localStorage.removeItem(SPECIAL_INSTRUCTIONS_KEY);
    } catch {
      // ignore
    }
    setResults({});
    setResultErrors({});
    setHistoryResult(null);
    setError(null);
    setSource("—");
    setContentType("—");
    setActiveHistoryId(null);
  }

  function forgetSavedResume() {
    setSavedResume(null);
    try {
      window.localStorage.removeItem(SAVED_RESUME_KEY);
    } catch {
      // ignore
    }
  }

  async function fetchHistory() {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch("/api/history", { method: "GET" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to load history");
      setHistory(
        Array.isArray(json?.items) ? (json.items as HistoryItem[]) : [],
      );
    } catch (e: unknown) {
      setHistoryError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }

  function loadFromHistory(item: HistoryItem) {
    setActiveHistoryId(item.id);

    setJobUrl("");
    setJobText(item.jobDesc ?? "");

    setResumeUrl("");
    setResumeFile(null);
    if (resumeFileInputRef.current) resumeFileInputRef.current.value = "";
    setResumeText(item.experience ?? "");
    setShowResumeAlt(true);

    setSpecialInstructions(item.specialInstructions ?? "");

    setResults({});
    setResultErrors({});

    try {
      const parsed = JSON.parse(item.resultJson);
      if (isOutput(parsed)) {
        setHistoryResult({
          output: parsed,
          applyUrl: item.applyUrl ?? null,
          jobDescText: item.jobDesc ?? "",
        });
        setError(null);
        setSource("Loaded from history");
        setContentType("—");
      } else {
        setHistoryResult(null);
        setError(
          "History item resultJson did not match expected Output shape.",
        );
      }
    } catch {
      setHistoryResult(null);
      setError("Failed to parse history resultJson.");
    }
  }

  useEffect(() => {
    fetchHistory();
  }, []);

  async function handleDeleteHistory(id: string) {
    try {
      const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed to delete (HTTP ${res.status})`);
      if (activeHistoryId === id) {
        setActiveHistoryId(null);
        setHistoryResult(null);
      }
      await fetchHistory();
    } catch (e: unknown) {
      setHistoryError(e instanceof Error ? e.message : "Failed to delete history item");
    }
  }

  async function runOneProvider(provider: Provider, signal: AbortSignal) {
    const formData = new FormData();
    formData.append("provider", provider);
    if (jobText.trim()) formData.append("jobText", jobText.trim());
    else if (jobUrl.trim()) formData.append("jobUrl", jobUrl.trim());

    if (specialInstructions.trim()) {
      formData.append("specialInstructions", specialInstructions.trim());
    }

    let newResumeSourceName: string | null = null;
    if (resumeFile) {
      formData.append("resumeFile", resumeFile);
      newResumeSourceName = resumeFile.name;
    } else if (resumeUrl.trim()) {
      formData.append("resumeUrl", resumeUrl.trim());
      newResumeSourceName = resumeUrl.trim();
    } else if (resumeText.trim()) {
      formData.append("resumeText", resumeText.trim());
      newResumeSourceName = "Pasted text";
    } else if (savedResume) {
      formData.append("resumeText", savedResume.text);
    }

    const res = await fetch("/api/generate", { method: "POST", body: formData, signal });
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      const code = errJson?.error as string | undefined;
      const message = errJson?.message ?? errJson?.error ?? `HTTP ${res.status}`;
      throw Object.assign(new Error(message), { code });
    }

    const json = (await res.json()) as Record<string, unknown>;
    const candidate = (json?.result ?? json) as Output;
    if (!isOutput(candidate)) {
      throw new Error("JSON response did not match expected Output shape.");
    }
    const output = candidate;
    const applyUrl = typeof json?.applyUrl === "string" ? json.applyUrl : null;
    const resumeTextEcho =
      typeof json?.resumeText === "string" ? json.resumeText : undefined;
    const jobDescTextEcho =
      typeof json?.jobDescText === "string" && json.jobDescText.trim()
        ? json.jobDescText
        : jobText.trim();

    return {
      output,
      applyUrl,
      contentType: ct,
      jobDescText: jobDescTextEcho,
      resumeSave:
        newResumeSourceName && resumeTextEcho
          ? { text: resumeTextEcho, name: newResumeSourceName }
          : null,
    };
  }

  async function run() {
    setError(null);
    setResults({});
    setResultErrors({});
    setHistoryResult(null);
    setSource("—");
    setContentType("—");
    setLoading(true);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const selected: Provider[] = [
      ...(useOpenAI ? (["openai"] as const) : []),
      ...(useClaude ? (["claude"] as const) : []),
    ];

    const settled = await Promise.allSettled(
      selected.map((p) => runOneProvider(p, controller.signal)),
    );

    const newResults: Partial<Record<Provider, ProviderResult>> = {};
    const newErrors: Partial<Record<Provider, string>> = {};
    let latestResumeSave: { text: string; name: string } | null = null;
    let latestContentType = "—";
    let aborted = false;

    settled.forEach((settledResult, i) => {
      const p = selected[i];
      if (settledResult.status === "fulfilled") {
        newResults[p] = {
          output: settledResult.value.output,
          applyUrl: settledResult.value.applyUrl,
          jobDescText: settledResult.value.jobDescText,
        };
        if (settledResult.value.resumeSave) {
          latestResumeSave = settledResult.value.resumeSave;
        }
        latestContentType = settledResult.value.contentType || latestContentType;
      } else {
        const err = settledResult.reason;
        if (err?.name === "AbortError") aborted = true;
        const code = err?.code as string | undefined;
        if (code === "JD_FETCH_BLOCKED" || code === "JD_RESOLUTION_FAILED") {
          setShowJobUrlField(true);
        }
        if (code === "RESUME_FETCH_BLOCKED" || code === "RESUME_RESOLUTION_FAILED") {
          setShowResumeAlt(true);
        }
        newErrors[p] = err?.message ?? String(err);
      }
    });

    setResults(newResults);
    setResultErrors(newErrors);
    setContentType(latestContentType);
    setSource(selected.map((p) => PROVIDER_LABEL[p]).join(" + ") || "—");

    if (aborted) {
      setError("Request stopped.");
    } else if (Object.keys(newResults).length === 0 && Object.keys(newErrors).length > 0) {
      setError(Object.values(newErrors)[0] ?? "Generation failed.");
    }

    const resumeSaveToPersist = latestResumeSave as { text: string; name: string } | null;
    if (resumeSaveToPersist) {
      persistSavedResume({
        text: resumeSaveToPersist.text,
        name: resumeSaveToPersist.name,
        savedAt: new Date().toISOString(),
      });
    }

    setLoading(false);
    controllerRef.current = null;
    fetchHistory();
  }

  const resultCount = Object.keys(results).length;

  return (
    <section className="space-y-4">
      <header className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Generator
            </h2>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Paste the job description, use your saved résumé (or upload
              once), hit Generate.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              Source: <span className="ml-1 font-semibold">{source}</span>
            </span>

            <span
              title={contentType}
              className="inline-flex max-w-[28rem] items-center truncate rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              Content-Type:{" "}
              <span className="ml-1 font-semibold">{contentType}</span>
            </span>

            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              History ({history.length}) {showHistory ? "▲" : "▼"}
            </button>
          </div>
        </div>

        {showHistory && (
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-600 dark:text-slate-300">
                Last 10 generations — click one to load it.
              </div>
              <button
                onClick={fetchHistory}
                disabled={historyLoading}
                className="h-8 rounded-lg bg-slate-200 px-3 text-xs font-semibold text-black shadow-sm hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-black dark:hover:bg-slate-300"
              >
                {historyLoading ? "Loading…" : "Refresh"}
              </button>
            </div>

            {historyError && (
              <div className="mt-2 text-sm text-rose-700 dark:text-rose-200">
                {historyError}
              </div>
            )}

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {history.length === 0 && !historyLoading ? (
                <div className="text-sm text-slate-600 dark:text-slate-300">
                  No saved generations yet.
                </div>
              ) : null}

              {history.map((item) => {
                const active = item.id === activeHistoryId;
                return (
                  <div
                    key={item.id}
                    className={[
                      "relative w-64 shrink-0 rounded-2xl border shadow-sm",
                      "hover:bg-slate-50 dark:hover:bg-slate-800/40",
                      active
                        ? "border-slate-500 bg-slate-50 dark:border-slate-400 dark:bg-slate-800/40"
                        : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => loadFromHistory(item)}
                      className="w-full px-3 py-2 pr-8 text-left"
                    >
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {formatWhen(item.createdAt)}
                      </div>
                      <div className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                        JD: {previewText(item.jobDesc, 44)}
                      </div>
                      {item.applyUrl && (
                        <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                          🔗 Apply link saved
                        </div>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteHistory(item.id);
                      }}
                      aria-label="Delete this history item"
                      title="Delete"
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </header>

      <div className="space-y-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Job description — paste-first, since most postings block scraping */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  1. Job description
                </div>
                <span
                  className={
                    jobReady
                      ? "text-xs font-semibold text-emerald-600 dark:text-emerald-400"
                      : "text-xs text-slate-500 dark:text-slate-400"
                  }
                >
                  {jobReady ? "✓ Ready" : "Needed"}
                </span>
              </div>

              <textarea
                value={jobText}
                onChange={(e) => setJobText(e.target.value)}
                rows={8}
                placeholder="Paste the job description text here — most job sites block automated scraping, so this is the reliable way in."
                className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
              />

              <button
                type="button"
                onClick={() => setShowJobUrlField((v) => !v)}
                className="mt-2 text-xs font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                {showJobUrlField
                  ? "Hide link option"
                  : "Have a link instead? (works for some sites)"}
              </button>

              {showJobUrlField && (
                <input
                  type="url"
                  value={jobUrl}
                  onChange={(e) => setJobUrl(e.target.value)}
                  placeholder="https://... (JD PDF link or job page — falls back to the text above if this fails)"
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                />
              )}
            </div>

            {/* Résumé — upload-once, reused across sessions */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  2. Your résumé
                </div>
                <span
                  className={
                    resumeReady
                      ? "text-xs font-semibold text-emerald-600 dark:text-emerald-400"
                      : "text-xs text-slate-500 dark:text-slate-400"
                  }
                >
                  {resumeReady ? "✓ Ready" : "Needed"}
                </span>
              </div>

              {willUseSavedResume ? (
                <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100">
                  <span className="truncate">
                    ✓ {previewText(savedResume!.name, 40)} — last used{" "}
                    {formatWhen(savedResume!.savedAt)}
                  </span>
                  <button
                    type="button"
                    onClick={forgetSavedResume}
                    className="shrink-0 font-semibold underline underline-offset-2"
                  >
                    Replace
                  </button>
                </div>
              ) : (
                <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  {savedResume
                    ? `New résumé below will replace "${savedResume.name}" (last used ${formatWhen(savedResume.savedAt)}) after this run.`
                    : "Upload your résumé PDF or DOCX once — it's saved in this browser and reused automatically next time."}
                </div>
              )}

              <input
                ref={resumeFileInputRef}
                type="file"
                accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setResumeFile(f);
                  if (f) setResumeUrl("");
                }}
                className="w-full text-xs text-slate-700 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-black hover:file:bg-slate-300 dark:text-slate-300"
              />

              <button
                type="button"
                onClick={() => setShowResumeAlt((v) => !v)}
                className="mt-2 text-xs font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                {showResumeAlt
                  ? "Hide link/paste options"
                  : "Prefer a link or paste instead?"}
              </button>

              {showResumeAlt && (
                <div className="mt-2 space-y-2">
                  <input
                    type="url"
                    value={resumeUrl}
                    onChange={(e) => {
                      setResumeUrl(e.target.value);
                      if (e.target.value) {
                        setResumeFile(null);
                        if (resumeFileInputRef.current)
                          resumeFileInputRef.current.value = "";
                      }
                    }}
                    placeholder="https://... (link to resume PDF)"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                  />
                  <textarea
                    value={resumeText}
                    onChange={(e) => setResumeText(e.target.value)}
                    rows={5}
                    placeholder={"Or paste résumé text...\n- Led ...\n- Built ..."}
                    className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              3. Special instructions{" "}
              <span className="font-normal text-slate-500 dark:text-slate-400">
                (optional)
              </span>
            </div>
            <textarea
              value={specialInstructions}
              onChange={(e) => updateSpecialInstructions(e.target.value)}
              rows={2}
              placeholder={
                "e.g. use Toby instead of Tobias; swap the GitHub link for github.com/...; lead with the remote-team experience"
              }
              className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
            />
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Applied on top of the JD-matching — the AI will confirm how each
              instruction was used in the &quot;How this was tailored&quot; note. Saved
              in this browser, so it&apos;s still here after a restart — click
              Clear to remove it.
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                AI Provider{" "}
                <span className="font-normal text-slate-500 dark:text-slate-400">
                  (check both to compare)
                </span>
              </span>
              <div className="flex h-10 items-center gap-4">
                <label className="inline-flex items-center gap-1.5 text-sm text-slate-800 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={useOpenAI}
                    onChange={(e) => setUseOpenAI(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                  />
                  ChatGPT
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm text-slate-800 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={useClaude}
                    onChange={(e) => setUseClaude(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                  />
                  Claude
                </label>
              </div>
            </div>

            <div className="flex flex-1 flex-wrap items-center gap-3">
              <button
                onClick={run}
                disabled={loading || !canRun}
                className="h-12 rounded-xl bg-indigo-600 px-6 text-base font-bold text-white shadow-md hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              >
                {loading ? "Generating…" : "Generate"}
              </button>

              <button
                onClick={stop}
                disabled={!loading}
                className="h-10 rounded-xl bg-slate-200 px-4 text-sm font-semibold text-black shadow-sm hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-black dark:hover:bg-slate-300"
              >
                Stop
              </button>

              <button
                onClick={clearAll}
                disabled={loading}
                className="h-10 rounded-xl bg-slate-200 px-4 text-sm font-semibold text-black shadow-sm hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-black dark:hover:bg-slate-300"
              >
                Clear
              </button>

              <span className="text-xs text-slate-600 dark:text-slate-300">
                {loading
                  ? "Fetching sources and calling the AI — this can take 10-30s."
                  : !canRun
                    ? "Waiting on: " +
                      [
                        !jobReady && "job description",
                        !resumeReady && "résumé",
                        !anyProviderSelected && "an AI provider",
                      ]
                        .filter(Boolean)
                        .join(" and ")
                    : "Ready to generate."}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/40">
            <div className="text-sm font-semibold text-rose-900 dark:text-rose-100">
              Error
            </div>
            <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-rose-900 dark:text-rose-100">
              {error}
            </pre>
          </div>
        )}

        {(Object.entries(resultErrors) as [Provider, string][]).map(
          ([p, msg]) =>
            results[p] ? null : (
              <div
                key={p}
                className="rounded-3xl border border-rose-200 bg-rose-50 p-5 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/40"
              >
                <div className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                  {PROVIDER_LABEL[p]} error
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-rose-900 dark:text-rose-100">
                  {msg}
                </pre>
              </div>
            ),
        )}

        {/* Output — front and center: editable tailored resume document(s) */}
        {historyResult && (
          <ResumeResultPanel
            providerLabel="History"
            output={historyResult.output}
            applyUrl={historyResult.applyUrl}
            jobDescText={historyResult.jobDescText}
          />
        )}

        {resultCount > 0 && (
          <div className="space-y-4">
            {results.openai && (
              <ResumeResultPanel
                providerLabel="ChatGPT"
                output={results.openai.output}
                applyUrl={results.openai.applyUrl}
                jobDescText={results.openai.jobDescText}
              />
            )}
            {results.claude && (
              <ResumeResultPanel
                providerLabel="Claude"
                output={results.claude.output}
                applyUrl={results.claude.applyUrl}
                jobDescText={results.claude.jobDescText}
              />
            )}
          </div>
        )}

        {!error && resultCount === 0 && !historyResult && (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            Fill in the job description and résumé above, then click
            Generate.
          </div>
        )}
      </div>
    </section>
  );
}
