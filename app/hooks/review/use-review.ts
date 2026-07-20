"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InferUIMessageChunk } from "ai";
import type { Issue } from "@/lib/review/issue";
import type {
  PRFileSummary,
  PRMeta,
  ReviewUIMessage,
} from "@/lib/review/stream";
import type {
  ErrorKind,
  ReviewStatus,
  TranscriptEntry,
} from "@/lib/review/transcript";
import { isErrorKind } from "@/lib/review/transcript";

type ReviewChunk = InferUIMessageChunk<ReviewUIMessage>;

export type ReviewRunOptions = {
  anthropicKey?: string;
  githubPat?: string;
};

function findToolEntry(entries: TranscriptEntry[], toolCallId: string) {
  return entries.find(
    (e): e is Extract<TranscriptEntry, { kind: "tool" }> =>
      e.kind === "tool" && e.toolCallId === toolCallId
  );
}

function errorKindFromResponse(res: Response): ErrorKind {
  const header = res.headers.get("x-review-error");
  if (header && isErrorKind(header)) return header;
  if (res.status === 429) return "rate-limit";
  if (res.status >= 500) return "review";
  return "load";
}

export function useReview() {
  const [status, setStatus] = useState<ReviewStatus>("idle");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [toolEntries, setToolEntries] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [meta, setMeta] = useState<PRMeta | null>(null);
  const [files, setFiles] = useState<PRFileSummary[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
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

  const clearReviewState = useCallback(() => {
    transcriptRef.current = [];
    flushTranscript();
    toolEntriesRef.current = [];
    setToolEntries([]);
    setIssues([]);
    setError(null);
    setErrorKind(null);
    setMeta(null);
    setFiles([]);
    setTotalTokens(0);
    setShareSlug(null);
    setRequestId(null);
  }, [flushTranscript]);

  const run = useCallback(
    async (prUrl: string, options: ReviewRunOptions = {}) => {
      if (abortRef.current) return;

      clearReviewState();
      setStatus("running");

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prUrl,
            anthropicKey: options.anthropicKey,
            githubPat: options.githubPat,
          }),
          signal: ac.signal,
        });

        setRequestId(res.headers.get("x-request-id"));

        if (!res.ok || !res.body) {
          const text = (await res.text().catch(() => "")).trim();
          setError(text || null);
          setErrorKind(errorKindFromResponse(res));
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
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  input: chunk.input,
                  outcome: "running",
                };
                entries.push(toolEntry);
                scheduleCommit();
                toolEntriesRef.current.push(toolEntry);
                setToolEntries(toolEntriesRef.current.slice());
                break;
              }

              case "tool-output-available": {
                const entry = findToolEntry(entries, chunk.toolCallId);
                if (entry) {
                  const output = chunk.output;
                  if (
                    output &&
                    typeof output === "object" &&
                    "status" in output
                  ) {
                    entry.outcome = "skipped";
                    entry.note = String(
                      (output as Record<string, unknown>).status
                    );
                  } else {
                    entry.outcome = "ok";
                  }
                  scheduleCommit();
                }
                break;
              }

              case "tool-output-error": {
                const entry = findToolEntry(entries, chunk.toolCallId);
                if (entry) {
                  entry.outcome = "failed";
                  scheduleCommit();
                }
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

              case "data-failover":
                entries.push({ kind: "failover", ...chunk.data });
                scheduleCommit();
                break;

              case "data-usage":
                setTotalTokens((t) => t + chunk.data.tokens);
                break;

              case "data-share":
                setShareSlug(chunk.data.slug);
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

              case "reasoning-start":
                entries.push({ kind: "text", text: "" });
                scheduleCommit();
                break;

              case "reasoning-delta": {
                const lastReasoning = entries[entries.length - 1];
                if (lastReasoning && lastReasoning.kind === "text") {
                  entries[entries.length - 1] = {
                    kind: "text",
                    text: lastReasoning.text + chunk.delta,
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
          setErrorKind("review");
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
        setErrorKind("review");
        setStatus("error");
      } finally {
        abortRef.current = null;
        flushTranscript();
      }
    },
    [clearReviewState, flushTranscript, scheduleCommit]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) return;

    clearReviewState();
    setStatus("idle");
  }, [clearReviewState]);

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
    errorKind,
    meta,
    files,
    totalTokens,
    shareSlug,
    requestId,
  };
}
