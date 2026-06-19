"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InferUIMessageChunk } from "ai";
import type { Issue } from "@/lib/review/issue";
import type {
  PRFileSummary,
  PRMeta,
  ReviewUIMessage,
} from "@/lib/review/stream";
import type { ReviewStatus, TranscriptEntry } from "@/lib/review/transcript";

type ReviewChunk = InferUIMessageChunk<ReviewUIMessage>;

export function useReview() {
  const [status, setStatus] = useState<ReviewStatus>("idle");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [toolEntries, setToolEntries] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<PRMeta | null>(null);
  const [files, setFiles] = useState<PRFileSummary[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const toolEntriesRef = useRef<TranscriptEntry[]>([]);
  const rafRef = useRef<number | null>(null);

  const commitTranscript = useCallback(() => {
    rafRef.current = null;
    setTranscript(transcriptRef.current.slice());
  }, []);

  const scheduleCommit = useCallback(() => {
    rafRef.current ??= requestAnimationFrame(commitTranscript);
  }, [commitTranscript]);

  const flushTranscript = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    commitTranscript();
  }, [commitTranscript]);

  const run = useCallback(
    async (prUrl: string) => {
      if (abortRef.current) return;

      transcriptRef.current = [];
      flushTranscript();
      toolEntriesRef.current = [];
      setToolEntries([]);

      setIssues([]);
      setError(null);
      setMeta(null);
      setFiles([]);
      setStatus("running");

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prUrl }),
          signal: ac.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          setError(
            `Request failed: ${res.status} ${res.statusText} ${text}`.trim()
          );
          setStatus("error");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamError: string | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const dataLine = frame
              .split("\n")
              .find((l) => l.startsWith("data:"));
            if (!dataLine) continue;

            const payload = dataLine.slice(dataLine.indexOf(":") + 1).trim();
            if (!payload || payload === "[DONE]") continue;

            let chunk: ReviewChunk;
            try {
              chunk = JSON.parse(payload) as ReviewChunk;
            } catch {
              continue;
            }

            const entries = transcriptRef.current;

            switch (chunk.type) {
              case "tool-input-available": {
                const toolEntry: TranscriptEntry = {
                  kind: "tool",
                  toolName: chunk.toolName,
                  input: chunk.input,
                };
                entries.push(toolEntry);
                scheduleCommit();
                toolEntriesRef.current.push(toolEntry);
                setToolEntries(toolEntriesRef.current.slice());
                break;
              }

              case "data-issue":
                setIssues((prev) => [...prev, chunk.data]);
                break;

              case "data-meta":
                setMeta(chunk.data);
                break;

              case "data-files":
                setFiles(chunk.data);
                break;

              case "text-start":
                entries.push({ kind: "text", text: "" });
                scheduleCommit();
                break;

              case "text-delta": {
                const last = entries[entries.length - 1];
                if (last && last.kind === "text") {
                  entries[entries.length - 1] = {
                    kind: "text",
                    text: last.text + chunk.delta,
                  };
                } else {
                  entries.push({ kind: "text", text: chunk.delta });
                }
                scheduleCommit();
                break;
              }

              case "error":
                streamError = chunk.errorText;
                break;

              default:
                break;
            }
          }
        }

        if (streamError) {
          setError(streamError);
          setStatus("error");
        } else {
          setStatus("done");
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setStatus("aborted");
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      } finally {
        abortRef.current = null;
        flushTranscript();
      }
    },
    [flushTranscript, scheduleCommit]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) return;

    transcriptRef.current = [];
    flushTranscript();
    toolEntriesRef.current = [];
    setToolEntries([]);
    setIssues([]);
    setError(null);
    setMeta(null);
    setFiles([]);
    setStatus("idle");
  }, [flushTranscript]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      abortRef.current?.abort();
    },
    []
  );

  return {
    run,
    stop,
    reset,
    status,
    issues,
    transcript,
    toolEntries,
    error,
    meta,
    files,
  };
}
