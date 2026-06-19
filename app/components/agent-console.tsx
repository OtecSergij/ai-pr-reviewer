"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "@/lib/review/transcript";
import { countSteps } from "@/lib/review/transcript";
import { REVIEW_TOOL_NAMES } from "@/lib/review/tools/tool-names";
import { Spinner } from "./spinner";
import { toolLabel } from "./transcript";

type AgentConsoleProps = {
  transcript: TranscriptEntry[];
  mode?: "live" | "trace";
};

function isConsoleEntry(entry: TranscriptEntry): boolean {
  if (entry.kind === "tool") {
    return entry.toolName !== REVIEW_TOOL_NAMES.emitIssue;
  }
  return entry.text !== "";
}

export const AgentConsole = memo(function AgentConsole({
  transcript,
  mode = "live",
}: AgentConsoleProps) {
  const trace = mode === "trace";
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const rows = transcript.filter(isConsoleEntry);
  const stepCount = countSteps(transcript);
  const lastTool = rows.filter((e) => e.kind === "tool").at(-1);
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
        <span className="shrink-0 text-[13px] font-semibold text-ink">
          {trace ? "Agent trace" : current ? current.label : "Starting review…"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#6e7781]">
          {trace ? "" : current?.detail ?? ""}
        </span>
        <span className="shrink-0 font-mono text-[10.5px] text-subtle">
          {trace ? `${stepCount} steps` : `step ${stepCount}`}
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-md border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-muted hover:border-[#c7c7cd]"
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>

      {bodyShown ? (
        <div
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="overflow-y-auto bg-[#fcfcfd] px-4 py-3 transition-[height] duration-200"
          style={trace ? { maxHeight: 480 } : { height: open ? 340 : 148 }}
        >
          {rows.map((entry, i) => {
            if (entry.kind === "tool") {
              const { label, detail } = toolLabel(entry.toolName, entry.input);
              return (
                <div
                  key={i}
                  className="whitespace-pre-wrap font-mono text-[12px] font-medium leading-[1.75] text-[#6366f1]"
                  style={{ marginTop: i === 0 ? 0 : 12 }}
                >
                  ▸ {label}
                  {detail ? `  ·  ${detail}` : ""}
                </div>
              );
            }
            const streaming = !trace && i === rows.length - 1;
            return (
              <div
                key={i}
                className="whitespace-pre-wrap font-mono text-[12px] leading-[1.75] text-[#6e7781]"
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
