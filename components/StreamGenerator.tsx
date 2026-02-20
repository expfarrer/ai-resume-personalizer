"use client";

import React, { useEffect, useRef, useState } from "react";

type Output = {
  summary: string;
  resumeBullets: string[];
  interviewQuestions: string[];
};

type Mode = "json" | "stream";

type HistoryItem = {
  id: string;
  createdAt: string;
  jobDesc: string;
  experience: string;
  resultJson: string;
};

function isOutput(x: any): x is Output {
  return (
    x &&
    typeof x.summary === "string" &&
    Array.isArray(x.resumeBullets) &&
    Array.isArray(x.interviewQuestions)
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
  const [mode, setMode] = useState<Mode>("json");
  const [jobDesc, setJobDesc] = useState("");
  const [experience, setExperience] = useState("");
  const [loading, setLoading] = useState(false);

  const [raw, setRaw] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<string>("—");
  const [contentType, setContentType] = useState<string>("—");

  const [copyStatus, setCopyStatus] = useState<string>("");

  // History
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  const canRun = jobDesc.trim().length > 0 && experience.trim().length > 0;

  function stop() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
  }

  function clearAll() {
    setJobDesc("");
    setExperience("");
    setRaw("");
    setOutput(null);
    setError(null);
    setSource("—");
    setContentType("—");
    setCopyStatus("");
    setActiveHistoryId(null);
  }

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
    } catch (e: any) {
      setStatusTemp(`Copy failed: ${e?.message ?? "permission denied"}`);
    }
  }

  function buildMarkdown(out: Output) {
    const bullets = out.resumeBullets.map((b) => `- ${b}`).join("\n");
    const questions = out.interviewQuestions.map((q) => `1. ${q}`).join("\n");

    return [
      `## Summary`,
      ``,
      out.summary.trim(),
      ``,
      `## Resume Bullets`,
      ``,
      bullets,
      ``,
      `## Interview Questions`,
      ``,
      questions,
      ``,
    ].join("\n");
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
    } catch (e: any) {
      setHistoryError(e?.message ?? "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }

  function loadFromHistory(item: HistoryItem) {
    setActiveHistoryId(item.id);
    setJobDesc(item.jobDesc ?? "");
    setExperience(item.experience ?? "");

    try {
      const parsed = JSON.parse(item.resultJson);
      if (isOutput(parsed)) {
        setOutput(parsed);
        setRaw(JSON.stringify(parsed, null, 2));
        setError(null);
        setSource("Loaded from history");
        setContentType("—");
      } else {
        setOutput(null);
        setRaw(item.resultJson);
        setError(
          "History item resultJson did not match expected Output shape.",
        );
      }
    } catch {
      setOutput(null);
      setRaw(item.resultJson);
      setError("Failed to parse history resultJson.");
    }
  }

  useEffect(() => {
    fetchHistory();
  }, []);

  async function run() {
    setError(null);
    setOutput(null);
    setRaw("");
    setSource("—");
    setContentType("—");
    setCopyStatus("");
    setLoading(true);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const url =
      mode === "stream" ? "/api/generate?stream=true" : "/api/generate";

    try {
      const res = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ jobDesc, experience }),
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });

      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      setContentType(ct || "—");

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      if (mode === "json") {
        setSource("JSON (non-stream endpoint)");
        const json = (await res.json()) as any;
        const candidate = (json?.result ?? json) as Output;

        if (!isOutput(candidate)) {
          setRaw(JSON.stringify(json, null, 2));
          throw new Error("JSON response did not match expected Output shape.");
        }

        setOutput(candidate);
        setRaw(JSON.stringify(candidate, null, 2));
        setActiveHistoryId(null);
      } else {
        setSource("Stream (mode selected)");

        const text = await res.text();
        setRaw(text);

        const parsed = JSON.parse(text);
        if (!isOutput(parsed)) {
          throw new Error(
            "Stream selected but JSON response did not match Output shape.",
          );
        }

        setSource("Stream selected, server returned JSON");
        setOutput(parsed);
        setActiveHistoryId(null);
      }
    } catch (err: any) {
      if (err?.name === "AbortError") setError("Request stopped.");
      else setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
      controllerRef.current = null;
      fetchHistory();
    }
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Generator
          </h2>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            One input. Choose mode. Run.
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
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Main content FIRST (left) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Job description
                </div>
                <textarea
                  value={jobDesc}
                  onChange={(e) => setJobDesc(e.target.value)}
                  rows={12}
                  placeholder="Paste job description..."
                  className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Experience bullets
                </div>
                <textarea
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  rows={12}
                  placeholder={"- Led ...\n- Built ..."}
                  className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Mode
                </span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as Mode)}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="json">JSON (non-stream)</option>
                  <option value="stream">Stream (stream=true)</option>
                </select>
              </label>

              <button
                onClick={run}
                disabled={loading || !canRun}
                className="h-10 rounded-xl bg-slate-200 px-4 text-sm font-semibold text-black shadow-sm hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-black dark:hover:bg-slate-300"
              >
                {loading ? "Running..." : "Run"}
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

              {output && (
                <div className="flex flex-wrap gap-2 sm:ml-auto">
                  <button
                    onClick={() => copyText("Summary", output.summary)}
                    className="h-10 rounded-xl bg-slate-200 px-4 text-sm font-semibold text-black shadow-sm hover:bg-slate-300 dark:bg-slate-200 dark:text-black dark:hover:bg-slate-300"
                  >
                    Copy Summary
                  </button>

                  <button
                    onClick={() =>
                      copyText("Bullets", output.resumeBullets.join("\n"))
                    }
                    className="h-10 rounded-xl bg-slate-200 px-4 text-sm font-semibold text-black shadow-sm hover:bg-slate-300 dark:bg-slate-200 dark:text-black dark:hover:bg-slate-300"
                  >
                    Copy Bullets
                  </button>

                  <button
                    onClick={() => copyText("Markdown", buildMarkdown(output))}
                    className="h-10 rounded-xl bg-slate-200 px-4 text-sm font-semibold text-black shadow-sm hover:bg-slate-300 dark:bg-slate-200 dark:text-black dark:hover:bg-slate-300"
                  >
                    Copy All as Markdown
                  </button>
                </div>
              )}
            </div>

            {copyStatus && (
              <div className="mt-3 inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {copyStatus}
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Raw response
              </div>
              <pre className="max-h-[420px] overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
                {raw || "(waiting...)"}
              </pre>
            </div>

            <div className="space-y-4">
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

              {output && (
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Parsed output
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                        Summary
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-900 dark:text-slate-100">
                        {output.summary}
                      </p>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                        Resume bullets
                      </div>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-900 dark:text-slate-100">
                        {output.resumeBullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                        Interview questions
                      </div>
                      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-900 dark:text-slate-100">
                        {output.interviewQuestions.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </div>
              )}

              {!error && !output && (
                <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  Choose a mode and click Run to see results.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* History sidebar SECOND (right) */}
        <aside className="lg:col-span-4 lg:border-l lg:border-slate-200 lg:pl-4 dark:lg:border-slate-800">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  History
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  Last 10 generations
                </div>
              </div>

              <button
                onClick={fetchHistory}
                disabled={historyLoading}
                className="h-9 rounded-xl bg-slate-200 px-3 text-sm font-semibold text-black shadow-sm hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-black dark:hover:bg-slate-300"
              >
                {historyLoading ? "Loading…" : "Refresh"}
              </button>
            </div>

            {historyError && (
              <div className="mt-3 text-sm text-rose-700 dark:text-rose-200">
                {historyError}
              </div>
            )}

            <div className="mt-4 space-y-2">
              {history.length === 0 && !historyLoading ? (
                <div className="text-sm text-slate-600 dark:text-slate-300">
                  No saved generations yet.
                </div>
              ) : null}

              {history.map((item) => {
                const active = item.id === activeHistoryId;
                return (
                  <button
                    key={item.id}
                    onClick={() => loadFromHistory(item)}
                    className={[
                      "w-full rounded-2xl border px-3 py-3 text-left shadow-sm",
                      "hover:bg-slate-50 dark:hover:bg-slate-800/40",
                      active
                        ? "border-slate-500 bg-slate-50 dark:border-slate-400 dark:bg-slate-800/40"
                        : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",
                    ].join(" ")}
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {formatWhen(item.createdAt)}
                    </div>
                    <div className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                      JD: {previewText(item.jobDesc)}
                    </div>
                    <div className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                      EXP: {previewText(item.experience)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
