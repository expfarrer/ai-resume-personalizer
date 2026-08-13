"use client";

import React, { useState } from "react";
import StreamGenerator from "@/components/StreamGenerator";

export default function Page() {
  const [showDocs, setShowDocs] = useState(false);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <header className="mb-12">
          <h1 className="text-3xl font-bold tracking-tight">
            AI Resume Personalizer
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            AI Resume Personalizer analyzes job descriptions and your experience
            to generate tailored summaries, optimized resume bullets, and
            targeted interview questions.
          </p>
        </header>

        <StreamGenerator />

        {/* Technical Documentation — collapsed by default, tucked out of the way */}
        <section className="mt-12">
          <button
            type="button"
            onClick={() => setShowDocs((v) => !v)}
            className="text-xs font-medium text-slate-500 underline underline-offset-4 hover:text-slate-800 dark:text-slate-500 dark:hover:text-slate-200"
          >
            Technical documentation {showDocs ? "▲" : "▼"}
          </button>

          {showDocs && (
            <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-2xl font-semibold tracking-tight">
                Technical Documentation
              </h2>

              <p className="mt-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                This application supports two response modes: standard JSON and
                streaming. Below is a simplified explanation of how both work and
                why they matter in real-world LLM integrations.
              </p>

              <div className="mt-8 space-y-8">
                <div>
                  <h3 className="text-lg font-semibold">
                    JSON Mode (Non-Streaming)
                  </h3>
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                    In JSON mode, the server processes the entire request and then
                    returns a single complete JSON response. The client waits until
                    the full result is available and parses it using
                    <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
                      await res.json()
                    </code>
                    .
                  </p>

                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
                    <li>Single request</li>
                    <li>Single complete JSON response</li>
                    <li>Simple implementation</li>
                    <li>Ideal for structured form workflows</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-lg font-semibold">Stream Mode</h3>
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                    In stream mode, the server sends the response in smaller chunks.
                    The client reads these chunks progressively using a stream
                    reader and assembles the final output as data arrives.
                  </p>

                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
                    <li>Data arrives incrementally</li>
                    <li>Client uses a readable stream</li>
                    <li>Improves perceived performance</li>
                    <li>Enables progressive rendering patterns</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-lg font-semibold">
                    Why Supporting Both Matters
                  </h3>
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                    Supporting both response types demonstrates understanding of
                    modern API design, browser stream handling, progressive
                    rendering, and production-ready LLM integration patterns.
                  </p>

                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
                    <li>Traditional request-response workflows</li>
                    <li>Streaming architectures</li>
                    <li>Frontend state management for async data</li>
                    <li>Scalable AI integration approaches</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
