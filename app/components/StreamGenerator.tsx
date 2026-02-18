"use client";

import React, { useRef, useState } from "react";

type Output = {
  summary: string;
  resumeBullets: string[];
  interviewQuestions: string[];
};

export default function StreamGenerator() {
  const [jobDesc, setJobDesc] = useState("");
  const [experience, setExperience] = useState("");
  const [loading, setLoading] = useState(false);

  // Shows either NDJSON stream text or raw JSON body for debugging
  const [raw, setRaw] = useState("");

  // Parsed output (if parsing succeeds)
  const [output, setOutput] = useState<Output | null>(null);

  // Displayable error text
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  async function startStream() {
    setError(null);
    setOutput(null);
    setRaw("");
    setLoading(true);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const res = await fetch(`/api/generate?stream=true`, {
        method: "POST",
        body: JSON.stringify({ jobDesc, experience }),
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

      // CASE 1: Server returns a single JSON payload (your current behavior)
      // content-type: application/json
      if (
        contentType.includes("application/json") &&
        !contentType.includes("ndjson")
      ) {
        const text = await res.text();
        setRaw(text);

        try {
          const parsed = JSON.parse(text) as Output;

          // light shape check
          if (
            typeof parsed?.summary === "string" &&
            Array.isArray(parsed?.resumeBullets) &&
            Array.isArray(parsed?.interviewQuestions)
          ) {
            setOutput(parsed);
          } else {
            throw new Error(
              "Parsed JSON does not match expected Output shape.",
            );
          }
          return;
        } catch (parseErr: any) {
          throw new Error(
            `Failed to parse JSON response: ${parseErr?.message ?? String(parseErr)}\n\nRaw response:\n${text.slice(
              0,
              4000,
            )}`,
          );
        }
      }

      // CASE 2: NDJSON streaming (application/x-ndjson) — parse line-by-line and assemble JSON text
      if (!res.body) throw new Error("No response body for streaming");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      const parts: string[] = [];
      let seenDone = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunkText = decoder.decode(value, { stream: true });

        // show raw stream content (NDJSON lines)
        setRaw((prev) => prev + chunkText);

        buffer += chunkText;

        // process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);

            if (obj.type === "chunk" && typeof obj.text === "string") {
              parts.push(obj.text);
            } else if (obj.type === "done") {
              seenDone = true;
            }
          } catch {
            // ignore parse errors for a malformed line
          }
        }
      }

      // attempt to process any leftover buffer (in case last line lacks newline)
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer);
          if (obj.type === "chunk" && typeof obj.text === "string")
            parts.push(obj.text);
          if (obj.type === "done") seenDone = true;
        } catch {
          // ignore
        }
      }

      if (!seenDone) {
        throw new Error(
          "Stream closed before a done marker was received. The assembled JSON may be partial.",
        );
      }

      const finalJsonText = parts.join("");
      try {
        const parsed = JSON.parse(finalJsonText) as Output;

        if (
          typeof parsed?.summary === "string" &&
          Array.isArray(parsed?.resumeBullets) &&
          Array.isArray(parsed?.interviewQuestions)
        ) {
          setOutput(parsed);
        } else {
          throw new Error("Parsed JSON does not match expected Output shape.");
        }
      } catch (parseErr: any) {
        throw new Error(
          `Failed to parse assembled JSON: ${parseErr?.message ?? String(parseErr)}\n\nAssembled (first 4000 chars):\n${finalJsonText.slice(
            0,
            4000,
          )}`,
        );
      }
    } catch (err: any) {
      if (err?.name === "AbortError") setError("Stream aborted");
      else setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
      controllerRef.current = null;
    }
  }

  function stopStream() {
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
  }

  return (
    <div style={{ maxWidth: 900, margin: "28px auto", padding: 14 }}>
      <h2 style={{ marginTop: 0 }}>Streaming Generator</h2>

      <label style={{ display: "block", marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Job description</div>
        <textarea
          value={jobDesc}
          onChange={(e) => setJobDesc(e.target.value)}
          rows={6}
          style={{ width: "100%", padding: 10, fontFamily: "inherit" }}
          placeholder="Paste job description..."
        />
      </label>

      <label style={{ display: "block", marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Experience bullets
        </div>
        <textarea
          value={experience}
          onChange={(e) => setExperience(e.target.value)}
          rows={5}
          style={{ width: "100%", padding: 10, fontFamily: "inherit" }}
          placeholder="- Led ...\n- Built ..."
        />
      </label>

      <div
        style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}
      >
        <button
          onClick={startStream}
          disabled={loading || !jobDesc.trim() || !experience.trim()}
          style={{ padding: "8px 12px", fontWeight: 700, cursor: "pointer" }}
        >
          {loading ? "Streaming..." : "Start stream"}
        </button>

        <button
          onClick={stopStream}
          disabled={!loading}
          style={{
            padding: "8px 12px",
            cursor: loading ? "pointer" : "not-allowed",
          }}
        >
          Stop
        </button>

        <button
          onClick={clearAll}
          disabled={loading}
          style={{ padding: "8px 12px", cursor: "pointer" }}
        >
          Clear
        </button>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <div
          style={{
            padding: 10,
            border: "1px solid #eee",
            background: "#fafafa",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Raw response</div>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {raw || "(waiting for response...)"}
          </pre>
        </div>

        {error && (
          <div
            style={{
              color: "crimson",
              padding: 10,
              border: "1px solid #ffd6d6",
            }}
          >
            <strong>Error:</strong>
            <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0 0" }}>
              {error}
            </pre>
          </div>
        )}

        {output && (
          <div style={{ padding: 10, border: "1px solid #ddd" }}>
            <h3 style={{ marginTop: 0 }}>Parsed output</h3>

            <section style={{ marginBottom: 10 }}>
              <strong>Summary</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{output.summary}</p>
            </section>

            <section style={{ marginBottom: 10 }}>
              <strong>Resume bullets</strong>
              <ul>
                {output.resumeBullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </section>

            <section>
              <strong>Interview questions</strong>
              <ol>
                {output.interviewQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
