"use client";

import { memo, useEffect, useId, useRef, useState } from "react";
import type { TranscriptEntry } from "@/lib/review/transcript";
import { countToolCalls, isTextEntry } from "@/lib/review/transcript";
import { REVIEW_TOOL_NAMES } from "@/lib/review/tools/tool-names";
import { Spinner } from "./spinner";
import {
  toolLabel,
  statusLabel,
  partLabel,
  providerLabel,
  reasonLabel,
} from "./transcript-labels";

type AgentConsoleProps = {
  transcript: TranscriptEntry[];
  mode?: "live" | "trace";
  notice?: string | null;
};

const BOLD_MARKER = /\*\*/g;

function stripBoldMarkers(text: string): string {
  return text.replace(BOLD_MARKER, "");
}

function isConsoleEntry(entry: TranscriptEntry): boolean {
  if (entry.kind === "tool") {
    return entry.toolName !== REVIEW_TOOL_NAMES.emitIssue;
  }
  if (isTextEntry(entry)) {
    return entry.text !== "";
  }
  return true;
}

export const AgentConsole = memo(function AgentConsole({
  transcript,
  mode = "live",
  notice = null,
}: AgentConsoleProps) {
  const trace = mode === "trace";
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const rows = transcript.flatMap((entry, index) =>
    isConsoleEntry(entry) ? [{ entry, index }] : [],
  );
  const toolCalls = countToolCalls(transcript);
  const lastTextRow = rows.findLastIndex(({ entry }) => isTextEntry(entry));
  const lastTool = rows.map((r) => r.entry).findLast((e) => e.kind === "tool");
  const current =
    lastTool && lastTool.kind === "tool"
      ? toolLabel(lastTool.toolName, lastTool.input)
      : null;

  useEffect(() => {
    if (trace) return;
    const el = bodyRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const bodyShown = !trace || open;

  return (
    <section className="animate-card-in overflow-hidden rounded-xl border border-border bg-white">
      <div
        className={`flex items-center gap-2.5 px-3.5 py-[11px] ${
          bodyShown ? "border-b border-[#f0f0f2]" : ""
        }`}
      >
        {trace ? null : (
          <Spinner className="h-3.5 w-3.5 shrink-0 border-[#c7d2fe] border-t-[#4f46e5]" />
        )}
        <h2 className="shrink-0 text-[13px] font-semibold text-ink">
          {trace ? "Agent trace" : current ? current.label : "Starting review…"}
        </h2>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#6e7781]">
          {trace ? "" : (current?.detail ?? "")}
        </span>
        <span className="shrink-0 font-mono text-[10.5px] text-subtle">
          {trace ? `${toolCalls} tool calls` : `call ${toolCalls}`}
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={trace ? open : undefined}
          aria-controls={bodyShown ? bodyId : undefined}
          className="shrink-0 rounded-md border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-muted hover:border-[#c7c7cd]"
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>

      {!trace && notice ? (
        <div
          role="status"
          className="border-b border-[#f0e3c8] bg-[#fffbf0] px-3.5 py-2 font-mono text-[11.5px] text-[#9a6700]"
        >
          {notice}
        </div>
      ) : null}

      {bodyShown ? (
        <div
          id={bodyId}
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="overflow-y-auto bg-[#fcfcfd] px-4 py-3 transition-[height] duration-200"
          style={trace ? { maxHeight: 550 } : { height: open ? 550 : 300 }}
        >
          {rows.map(({ entry, index }, i) => {
            if (entry.kind === "tool") {
              const { label, detail } = toolLabel(entry.toolName, entry.input);
              const part = partLabel(entry.patchPart);
              return (
                <div
                  key={`entry-${index}`}
                  className="whitespace-pre-wrap font-mono text-[12px] font-medium leading-[1.75] text-[#6366f1]"
                  style={{ marginTop: i === 0 ? 0 : 12 }}
                >
                  ▸ {label}
                  {detail ? `  ·  ${detail}` : ""}
                  {part ? (
                    <span className="text-[#6e7781]">{`  ·  ${part}`}</span>
                  ) : null}
                  {entry.outcome === "skipped" ? (
                    <span className="text-[#6e7781]">
                      {`  ·  ${statusLabel(entry.note)}`}
                    </span>
                  ) : entry.outcome === "failed" ? (
                    <span className="text-[#9a6700]">{"  ·  failed"}</span>
                  ) : null}
                </div>
              );
            }
            if (entry.kind === "failover") {
              return (
                <div
                  key={`entry-${index}`}
                  className="my-2 flex items-center gap-2 font-mono text-[11px] font-semibold text-[#9a6700]"
                >
                  <span className="h-px flex-1 bg-[#f0e3c8]" />
                  <span className="shrink-0">
                    {providerLabel(entry.from)} {reasonLabel(entry.reason)} —
                    switching to {providerLabel(entry.to)}
                  </span>
                  <span className="h-px flex-1 bg-[#f0e3c8]" />
                </div>
              );
            }
            const streaming = !trace && i === lastTextRow;
            if (entry.kind === "reasoning") {
              return (
                <ReasoningRow
                  key={`entry-${index}`}
                  text={entry.text}
                  streaming={streaming}
                  first={i === 0}
                />
              );
            }
            return (
              <div
                key={`entry-${index}`}
                className="whitespace-pre-wrap font-mono text-[12px] leading-[1.75] text-muted"
                style={{ marginTop: i === 0 ? 0 : 10 }}
              >
                {entry.text}
                {streaming ? <span className="text-subtle">▌</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
});

function ReasoningRow({
  text,
  streaming,
  first,
}: {
  text: string;
  streaming: boolean;
  first: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  const clamped = !streaming && !open;

  useEffect(() => {
    if (!clamped) return;
    const el = textRef.current;
    if (el) setClipped(el.scrollHeight > el.clientHeight);
  }, [clamped, text]);

  return (
    <div
      className="border-l border-border pl-2.5"
      style={{ marginTop: first ? 0 : 10 }}
    >
      <div
        ref={textRef}
        className={`whitespace-pre-wrap font-mono text-[12px] italic leading-[1.75] text-[#6e7781] ${
          clamped ? "line-clamp-3" : ""
        }`}
      >
        {stripBoldMarkers(text)}
        {streaming ? <span className="text-subtle">▌</span> : null}
      </div>
      {(clamped && clipped) || open ? (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-0.5 font-mono text-[11px] font-semibold text-subtle hover:text-muted"
        >
          {open ? "hide thinking" : "show thinking"}
        </button>
      ) : null}
    </div>
  );
}
