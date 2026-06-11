"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { ToolActivity } from "@/app/hooks/review/types";
import { REVIEW_TOOL_NAMES } from "@/lib/ai/tools/names";

type AgentPanelProps = {
  /** Текущий тул — сырые toolName+input из хука; в строку превращаем здесь. */
  activity: ToolActivity | null;
  text: string;
  done: boolean;
};

function labelForTool({ toolName, input }: ToolActivity): string {
  const i = input as Record<string, unknown> | undefined;
  switch (toolName) {
    case REVIEW_TOOL_NAMES.getDiff:
      return `Читаю diff: ${i?.filename ?? "…"}`;
    case REVIEW_TOOL_NAMES.getFileContents:
      return `Читаю файл: ${i?.path ?? "…"}`;
    case REVIEW_TOOL_NAMES.getPrMetadata:
      return "Читаю метаданные PR…";
    case REVIEW_TOOL_NAMES.getPrFilesSummary:
      return "Смотрю список файлов…";
    case REVIEW_TOOL_NAMES.listDirectory:
      return `Смотрю папку: ${i?.path ?? "…"}`;
    default:
      return "Работаю…";
  }
}

export const AgentPanel = memo(function AgentPanel({
  activity,
  text,
  done,
}: AgentPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    if (text.length < shownRef.current) {
      shownRef.current = text.length;
      setShown(text.length);
    }
    if (shownRef.current >= text.length) return;

    let raf: number;
    const tick = () => {
      const remaining = text.length - shownRef.current;
      if (remaining <= 0) return;
      const step = Math.max(1, Math.ceil(remaining / 30));
      shownRef.current = Math.min(text.length, shownRef.current + step);
      setShown(shownRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  if (!text && !activity) return null;

  const typing = shown < text.length;

  return (
    <section className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50">
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 text-sm text-zinc-600">
        {done && !typing ? (
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
        ) : (
          <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-400" />
        )}
        {done && !typing
          ? "Готово"
          : activity
            ? labelForTool(activity)
            : "Думаю…"}
      </header>
      <div
        ref={bodyRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="max-h-48 overflow-y-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-relaxed text-zinc-500"
      >
        {text.slice(0, shown)}
        {typing ? <span className="text-zinc-400">▌</span> : null}
      </div>
    </section>
  );
});
