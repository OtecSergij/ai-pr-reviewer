"use client";

import { useEffect, useRef, useState } from "react";
import type { InferUIMessageChunk } from "ai";
import type { Issue } from "@/lib/review/issue";
import type { PRMeta, ReviewUIMessage } from "@/lib/review/stream";
import type { PRFileSummary } from "@/lib/github/octokit";

// Экспортится только ToolActivity — его импортит agent-panel. ReviewStatus и
// ReviewChunk используются только здесь, поэтому остаются локальными.
type ReviewStatus = "idle" | "running" | "done" | "error" | "aborted";

export type ToolActivity = { toolName: string; input: unknown };

type ReviewChunk = InferUIMessageChunk<ReviewUIMessage>;

export function useReview() {
  const [status, setStatus] = useState<ReviewStatus>("idle");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [activity, setActivity] = useState<ToolActivity | null>(null);
  const [agentText, setAgentText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<PRMeta | null>(null);
  const [files, setFiles] = useState<PRFileSummary[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const textRef = useRef("");
  const rafRef = useRef<number | null>(null);

  function commitText() {
    rafRef.current = null;
    setAgentText(textRef.current);
  }

  function pushText(s: string) {
    textRef.current += s;
    rafRef.current ??= requestAnimationFrame(commitText);
  }

  function flushText() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    commitText();
  }

  async function run(prUrl: string) {
    if (abortRef.current) return;

    textRef.current = "";
    flushText();

    setIssues([]);
    setActivity(null);
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
      // Сбои после старта стрима приходят error-чанком внутри тела (HTTP уже
      // 200) — фиксируем и не даём финальному setStatus("done") их затереть.
      let streamError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;

          const payload = dataLine.slice(dataLine.indexOf(":") + 1).trim();
          if (!payload || payload === "[DONE]") continue;

          let chunk: ReviewChunk;
          try {
            chunk = JSON.parse(payload) as ReviewChunk;
          } catch {
            continue;
          }

          switch (chunk.type) {
            case "tool-input-available":
              setActivity({ toolName: chunk.toolName, input: chunk.input });
              break;

            case "data-issue":
              setIssues((issues) => [...issues, chunk.data]);
              break;

            case "data-meta":
              setMeta(chunk.data);
              break;

            case "data-files":
              setFiles(chunk.data);
              break;

            case "text-delta":
              pushText(chunk.delta);
              break;

            case "text-start":
              if (textRef.current) pushText("\n\n");
              break;

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
      flushText();
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  useEffect(
    () => () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
      stop();
    },
    []
  );

  return { run, stop, status, issues, activity, error, agentText, meta, files };
}
