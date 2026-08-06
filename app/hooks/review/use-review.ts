"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FinishReason, InferUIMessageChunk } from "ai";
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
  TranscriptTextKind,
} from "@/lib/review/transcript";
import {
  isDegenerateText,
  isErrorKind,
  isTextEntry,
  revealTranscript,
  totalTextChars,
} from "@/lib/review/transcript";

type ReviewChunk = InferUIMessageChunk<ReviewUIMessage>;

const REVEAL_CHARS_PER_SECOND = 200;
const NOMINAL_FRAME_MS = 1000 / 60;

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

function appendDelta(
  entries: TranscriptEntry[],
  kind: TranscriptTextKind,
  delta: string
): void {
  const last = entries[entries.length - 1];
  if (last && isTextEntry(last) && last.kind === kind) {
    entries[entries.length - 1] = { kind, text: last.text + delta };
  } else {
    entries.push({ kind, text: delta });
  }
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
  const [finishReason, setFinishReason] = useState<FinishReason | null>(null);
  const [meta, setMeta] = useState<PRMeta | null>(null);
  const [files, setFiles] = useState<PRFileSummary[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const toolEntriesRef = useRef<TranscriptEntry[]>([]);
  const rafRef = useRef<number | null>(null);
  const revealedRef = useRef(0);
  const lastFrameAtRef = useRef<number | null>(null);

  const scheduleCommit = useCallback(() => {
    if (rafRef.current != null) return;

    function frame(now: number) {
      rafRef.current = null;
      const entries = transcriptRef.current;
      const total = totalTextChars(entries);
      const dt =
        lastFrameAtRef.current === null
          ? NOMINAL_FRAME_MS
          : now - lastFrameAtRef.current;
      const step = Math.max(
        1,
        Math.round((REVEAL_CHARS_PER_SECOND * dt) / 1000)
      );
      const revealed = Math.min(total, revealedRef.current + step);
      revealedRef.current = revealed;
      setTranscript(revealTranscript(entries, revealed));
      if (revealed < total) {
        lastFrameAtRef.current = now;
        rafRef.current = requestAnimationFrame(frame);
      } else {
        lastFrameAtRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(frame);
  }, []);

  const flushTranscript = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastFrameAtRef.current = null;
    revealedRef.current = totalTextChars(transcriptRef.current);
    setTranscript(transcriptRef.current.slice());
  }, []);

  const clearReviewState = useCallback(() => {
    transcriptRef.current = [];
    flushTranscript();
    toolEntriesRef.current = [];
    setToolEntries([]);
    setIssues([]);
    setError(null);
    setErrorKind(null);
    setFinishReason(null);
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
        const openBlocks = new Map<string, number>();

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
                setFinishReason(null);
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
                openBlocks.set(`text:${chunk.id}`, entries.length - 1);
                scheduleCommit();
                break;

              case "text-delta": {
                const idx = openBlocks.get(`text:${chunk.id}`);
                const open = idx === undefined ? undefined : entries[idx];
                if (idx !== undefined && open?.kind === "text") {
                  entries[idx] = {
                    kind: "text",
                    text: open.text + chunk.delta,
                  };
                } else {
                  appendDelta(entries, "text", chunk.delta);
                }
                scheduleCommit();
                break;
              }

              case "reasoning-start":
                entries.push({ kind: "reasoning", text: "" });
                openBlocks.set(`reasoning:${chunk.id}`, entries.length - 1);
                scheduleCommit();
                break;

              case "reasoning-delta": {
                const idx = openBlocks.get(`reasoning:${chunk.id}`);
                const open = idx === undefined ? undefined : entries[idx];
                if (idx !== undefined && open?.kind === "reasoning") {
                  entries[idx] = {
                    kind: "reasoning",
                    text: open.text + chunk.delta,
                  };
                } else {
                  appendDelta(entries, "reasoning", chunk.delta);
                }
                scheduleCommit();
                break;
              }

              case "text-end":
              case "reasoning-end": {
                const kind: TranscriptTextKind =
                  chunk.type === "text-end" ? "text" : "reasoning";
                const key = `${kind}:${chunk.id}`;
                const idx = openBlocks.get(key);
                openBlocks.delete(key);
                if (idx === undefined) break;
                const open = entries[idx];
                if (
                  open &&
                  isTextEntry(open) &&
                  open.kind === kind &&
                  isDegenerateText(open.text)
                ) {
                  entries[idx] = { kind, text: "" };
                  scheduleCommit();
                }
                break;
              }

              case "error":
                streamError = chunk.errorText;
                break;

              case "finish":
                setFinishReason(chunk.finishReason ?? null);
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
    finishReason,
    meta,
    files,
    totalTokens,
    shareSlug,
    requestId,
  };
}
