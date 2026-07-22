import { memo } from "react";
import type { ReviewStatus } from "@/lib/review/transcript";
import type { PRMeta } from "@/lib/review/stream";
import { Spinner } from "./spinner";
import { formatElapsed } from "./format";
import { TONE } from "./review-theme";

type WorkspacePhase = Exclude<ReviewStatus, "idle">;

type WorkspaceHeaderProps = {
  meta: PRMeta | null;
  status: WorkspacePhase;
  elapsed: number;
  tokens: number;
  onStop: () => void;
  onHome: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
};

function statusBadge(status: WorkspacePhase, elapsed: number) {
  switch (status) {
    case "running":
      return {
        bg: TONE.info.bg,
        color: TONE.info.fg,
        label: "Reviewing",
        time: formatElapsed(elapsed),
        spinner: true,
      };
    case "done":
      return {
        bg: TONE.success.bg,
        color: TONE.success.fg,
        label: "Complete",
        time: formatElapsed(elapsed),
        spinner: false,
      };
    case "aborted":
      return {
        bg: TONE.warning.bg,
        color: TONE.warning.fg,
        label: "Stopped",
        time: formatElapsed(elapsed),
        spinner: false,
      };
    case "error":
      return {
        bg: TONE.danger.bg,
        color: TONE.danger.fg,
        label: "Error",
        time: "",
        spinner: false,
      };
  }
}

export const WorkspaceHeader = memo(function WorkspaceHeader({
  meta,
  status,
  elapsed,
  tokens,
  onStop,
  onHome,
  headingRef,
}: WorkspaceHeaderProps) {
  const badge = statusBadge(status, elapsed);
  const repoLabel = meta ? `${meta.owner}/${meta.repo} #${meta.prNumber}` : "";

  return (
    <header className="sticky top-0 z-20 flex h-[54px] items-center gap-3.5 border-b border-border bg-white/90 px-5 backdrop-blur-[8px]">
      <button
        type="button"
        onClick={onHome}
        disabled={status === "running"}
        title="Start a new review"
        className="flex shrink-0 items-center gap-2.5"
      >
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-ink font-mono text-[9px] font-semibold text-white">
          PR
        </span>
        <span className="text-[13px] font-bold tracking-[-0.01em]">
          AI PR Reviewer
        </span>
      </button>

      <div className="h-[18px] w-px shrink-0 bg-border" />

      <h1
        ref={headingRef}
        tabIndex={-1}
        className="flex min-w-0 flex-1 items-baseline gap-2.5 outline-none"
      >
        <span className="shrink-0 whitespace-nowrap font-mono text-[12px] text-muted">
          {repoLabel}
        </span>
        <span className="truncate text-[13px] text-faint">
          {meta?.title ?? ""}
        </span>
        {meta ? null : <span className="sr-only">Review workspace</span>}
      </h1>

      {tokens > 0 ? (
        <div
          className="shrink-0 whitespace-nowrap font-mono text-[11px] text-faint"
          title="Total tokens used"
        >
          {tokens.toLocaleString()} tokens
        </div>
      ) : null}

      {meta ? (
        <div className="shrink-0 rounded-full border border-border bg-white px-2.5 py-1 font-mono text-[11px] text-muted">
          {meta.model}
        </div>
      ) : null}

      <div
        className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-[5px] text-[12px] font-semibold tabular-nums"
        style={{ backgroundColor: badge.bg, color: badge.color }}
      >
        {badge.spinner ? (
          <Spinner className="h-[11px] w-[11px] border-[#4338ca]/25 border-t-[#4338ca]" />
        ) : null}
        <span className="sr-only" role="status">
          {badge.label}
        </span>
        <span aria-hidden="true">
          {badge.time ? `${badge.label} ${badge.time}` : badge.label}
        </span>
      </div>

      {status === "running" ? (
        <button
          onClick={onStop}
          className="h-[30px] shrink-0 rounded-lg border border-border-strong bg-white px-3.5 text-[12px] font-semibold text-ink hover:border-subtle"
        >
          Stop
        </button>
      ) : null}
    </header>
  );
});
