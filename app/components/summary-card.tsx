"use client";

import type { Issue } from "@/lib/review/issue";
import type { PRMeta } from "@/lib/review/stream";
import { SEVERITY_STYLES, severityPills } from "./review-theme";
import { formatElapsed } from "./format";
import { CopyButton } from "./copy-button";

type SummaryCardProps = {
  issues: Issue[];
  meta: PRMeta | null;
  stepCount: number;
  elapsed: number;
  stopped: boolean;
  isPrivate: boolean;
  shareSlug: string | null;
};

export function SummaryCard({
  issues,
  meta,
  stepCount,
  elapsed,
  stopped,
  isPrivate,
  shareSlug,
}: SummaryCardProps) {
  const pills = severityPills(issues);

  const n = issues.length;
  const repo = meta
    ? `${meta.owner}/${meta.repo} #${meta.prNumber}`
    : "this pull request";
  const sub = stopped
    ? `Partial results — ${n} issue${
        n === 1 ? "" : "s"
      } found before the run was stopped.`
    : `Found ${n} issue${n === 1 ? "" : "s"} in ${repo}.`;
  const head = meta?.headSha ? `head ${meta.headSha.slice(0, 7)}` : null;
  const doneMeta = [
    meta?.model,
    `${stepCount} steps`,
    formatElapsed(elapsed),
    head,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="animate-card-in rounded-xl border border-border bg-white p-[18px]">
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
          style={{ backgroundColor: stopped ? "#d4a72c" : "#2da44e" }}
        >
          {stopped ? "!" : "✓"}
        </div>
        <div className="text-[16px] font-bold tracking-[-0.01em]">
          {stopped ? "Review stopped" : "Review complete"}
        </div>
      </div>

      <div className="mt-1.5 text-[13px] text-muted">{sub}</div>

      {pills.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {pills.map((p, i) => (
            <div
              key={p.severity}
              className="animate-card-in rounded-full border px-3 py-1 text-[12px] font-semibold"
              style={{
                backgroundColor: SEVERITY_STYLES[p.severity].bg,
                color: SEVERITY_STYLES[p.severity].color,
                borderColor: SEVERITY_STYLES[p.severity].border,
                animationDelay: `${i * 0.08}s`,
              }}
            >
              {p.label}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 font-mono text-[11px] text-faint">
        {doneMeta}
      </div>

      {!stopped && !isPrivate && shareSlug ? (
        <ShareBlock slug={shareSlug} />
      ) : null}

      {stopped || isPrivate ? (
        <div className="mt-3.5 rounded-lg border border-border bg-[#f9f9fa] px-3 py-2.5 text-[12px] text-muted">
          {isPrivate
            ? "Private review — results are not saved and no share link is created."
            : "Stopped reviews are not saved — run the review to completion to get a share link."}
        </div>
      ) : null}

      <div className="mt-3 text-[11px] text-subtle">
        AI-generated review — may contain mistakes. Every issue links to the
        exact lines on GitHub.
      </div>
    </div>
  );
}

function ShareBlock({ slug }: { slug: string }) {
  const url = `${window.location.origin}/r/${slug}`;

  return (
    <div className="mt-3.5 flex items-center gap-2.5 border-t border-[#f0f0f2] pt-3.5">
      <div className="shrink-0 text-[12px] font-semibold text-muted">
        Share
      </div>
      <div className="min-w-0 flex-1 truncate rounded-lg border border-border bg-[#f9f9fa] px-3 py-2 font-mono text-[12px] text-ink">
        {url.replace(/^https?:\/\//, "")}
      </div>
      <CopyButton
        text={url}
        className="h-[34px] shrink-0 rounded-lg border border-ink bg-ink px-3.5 text-[12px] font-semibold text-white hover:bg-ink-soft"
      />
    </div>
  );
}
