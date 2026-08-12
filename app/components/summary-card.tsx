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
  truncated: boolean;
  usedOwnKey: boolean;
  isPrivate: boolean;
  shareSlug: string | null;
  saveFailed: boolean;
};

const OUTCOME = {
  complete: {
    accent: "#2da44e",
    glyph: "✓",
    title: "Review complete",
  },
  stopped: {
    accent: "#d4a72c",
    glyph: "!",
    title: "Review stopped",
  },
  truncated: {
    accent: "#d4a72c",
    glyph: "!",
    title: "Review cut short",
  },
} as const;

const PRIVATE_NOTICE =
  "Private review — results are not saved and no share link is created.";
const STOPPED_NOTICE =
  "Stopped reviews are not saved — run the review to completion to get a share link.";
const TRUNCATED_FREE_NOTICE =
  "This PR is too large for the free model to review in full — partial results aren't saved. Running with your own Anthropic key usually covers more.";
const TRUNCATED_OWN_KEY_NOTICE =
  "This PR is too large to review in full — partial results aren't saved.";
const SAVE_FAILED_NOTICE =
  "Couldn't create a share link — run the review again to get one.";

function noticeText({
  isPrivate,
  stopped,
  truncated,
  usedOwnKey,
  saveFailed,
}: {
  isPrivate: boolean;
  stopped: boolean;
  truncated: boolean;
  usedOwnKey: boolean;
  saveFailed: boolean;
}): string | null {
  if (isPrivate) return PRIVATE_NOTICE;
  if (stopped) return STOPPED_NOTICE;
  if (truncated)
    return usedOwnKey ? TRUNCATED_OWN_KEY_NOTICE : TRUNCATED_FREE_NOTICE;
  if (saveFailed) return SAVE_FAILED_NOTICE;
  return null;
}

export function SummaryCard({
  issues,
  meta,
  stepCount,
  elapsed,
  stopped,
  truncated,
  usedOwnKey,
  isPrivate,
  shareSlug,
  saveFailed,
}: SummaryCardProps) {
  const pills = severityPills(issues);

  const n = issues.length;
  const repo = meta
    ? `${meta.owner}/${meta.repo} #${meta.prNumber}`
    : "this pull request";
  const variant =
    OUTCOME[stopped ? "stopped" : truncated ? "truncated" : "complete"];
  const sub =
    stopped || truncated
      ? null
      : `Found ${n} issue${n === 1 ? "" : "s"} in ${repo}.`;
  const notice = noticeText({
    isPrivate,
    stopped,
    truncated,
    usedOwnKey,
    saveFailed,
  });
  const onSonnet = meta?.model?.startsWith("claude") ?? usedOwnKey;
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
          style={{ backgroundColor: variant.accent }}
        >
          {variant.glyph}
        </div>
        <h2 className="text-[16px] font-bold tracking-[-0.01em]">
          {variant.title}
        </h2>
      </div>

      {sub ? <div className="mt-1.5 text-[13px] text-muted">{sub}</div> : null}

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

      <div className="mt-3 font-mono text-[11px] text-faint">{doneMeta}</div>

      {!stopped && !isPrivate && shareSlug ? (
        <ShareBlock slug={shareSlug} />
      ) : null}

      {notice ? (
        <div className="mt-3.5 rounded-lg border border-border bg-[#f9f9fa] px-3 py-2.5 text-[12px] text-muted">
          {notice}
        </div>
      ) : null}

      <div className="mt-3 text-[11px] text-subtle">
        {onSonnet
          ? "AI-generated review — may contain mistakes."
          : "AI-generated review by a small free-tier model — may contain mistakes."}
      </div>
    </div>
  );
}

function ShareBlock({ slug }: { slug: string }) {
  const url = `${window.location.origin}/r/${slug}`;

  return (
    <div className="mt-3.5 flex items-center gap-2.5 border-t border-[#f0f0f2] pt-3.5">
      <div className="shrink-0 text-[12px] font-semibold text-muted">Share</div>
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
