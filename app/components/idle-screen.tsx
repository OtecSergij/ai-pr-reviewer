"use client";

import { useState } from "react";
import type { ReviewRunOptions } from "@/app/hooks/review/use-review";
import { MAX_CHANGED_FILES } from "@/lib/review/config";

type IdleScreenProps = {
  url: string;
  onUrlChange: (url: string) => void;
  visibility: "public" | "private";
  onVisibilityChange: (v: "public" | "private") => void;
  onStart: (options: ReviewRunOptions) => void;
};

const FIELD_BOX =
  "h-[42px] w-full min-w-0 rounded-[9px] border border-border-strong bg-[#fafafa] focus-within:border-[#6366f1] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]";

const FIELD_TEXT = "px-3.5 font-mono text-[13px] text-ink outline-none";

const INPUT_CLASS = `${FIELD_BOX} ${FIELD_TEXT}`;

const DEMO_PR_URL = "https://github.com/OtecSergij/ai-pr-reviewer/pull/6";

export function IdleScreen({
  url,
  onUrlChange,
  visibility,
  onVisibilityChange,
  onStart,
}: IdleScreenProps) {
  const [premium, setPremium] = useState(false);
  const [pat, setPat] = useState("");
  const [premiumKey, setPremiumKey] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onStart({
      anthropicKey:
        premium && premiumKey.trim() ? premiumKey.trim() : undefined,
      githubPat:
        visibility === "private" && pat.trim() ? pat.trim() : undefined,
    });
  }

  return (
    <div className="flex min-h-screen justify-center px-6 pb-[60px] pt-[130px]">
      <div className="animate-fade-up w-full max-w-[750px]">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-ink font-mono text-[12px] font-semibold text-white">
            PR
          </div>
          <div className="text-[22px] font-bold tracking-[-0.02em] text-ink">
            AI PR Reviewer
          </div>
        </div>

        <p className="mt-3.5 max-w-[500px] text-[15px] leading-[1.6] text-muted [text-wrap:pretty]">
          Paste a link to a GitHub pull request — an AI agent will walk the
          repository, read the changes in context, and stream back a review.
        </p>

        <form
          onSubmit={submit}
          className="mt-7 rounded-[14px] border border-border bg-white p-[18px] shadow-[0_1px_2px_rgba(24,24,27,0.04)]"
        >
          <div className="flex flex-wrap gap-2.5">
            <div
              className={`${FIELD_BOX} flex min-w-0 flex-1 basis-[260px] items-center`}
            >
              <input
                type="url"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                required
                placeholder="https://github.com/owner/repo/pull/123"
                aria-label="GitHub pull request URL"
                className={`h-full w-full min-w-0 bg-transparent ${FIELD_TEXT}`}
              />
              <button
                type="button"
                onClick={() => onUrlChange(DEMO_PR_URL)}
                className="flex h-full shrink-0 items-center whitespace-nowrap pl-3 pr-3.5 text-[12.5px] text-link hover:underline"
              >
                use demo PR
              </button>
            </div>
            <button
              type="submit"
              className="h-[42px] shrink-0 rounded-[9px] border border-ink bg-ink px-[22px] text-[14px] font-semibold text-white hover:bg-ink-soft"
            >
              Review
            </button>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-[18px]">
            <div className="flex gap-0.5 rounded-lg bg-surface-subtle p-[3px]">
              {(["public", "private"] as const).map((v) => {
                const active = visibility === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onVisibilityChange(v)}
                    className={`rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold ${
                      active
                        ? "bg-white text-ink shadow-[0_1px_2px_rgba(24,24,27,0.08)]"
                        : "text-[#71717a]"
                    }`}
                  >
                    {v === "public" ? "Public PR" : "Private PR"}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
                <input
                  type="checkbox"
                  checked={premium}
                  onChange={(e) => setPremium(e.target.checked)}
                  className="m-0 h-3.5 w-3.5 accent-ink"
                />
                Use Claude Sonnet — bring your own API key
              </label>
              <span className="group relative flex">
                <button
                  type="button"
                  aria-describedby="sonnet-tip"
                  className="flex h-[15px] w-[15px] cursor-default items-center justify-center rounded-full border border-border text-[9.5px] font-semibold text-subtle hover:border-[#c7c7cd] hover:text-muted"
                >
                  ?
                </button>
                <span
                  id="sonnet-tip"
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-[250px] -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-[11.5px] font-normal leading-[1.5] text-white opacity-0 shadow-[0_4px_12px_rgba(24,24,27,0.2)] transition-opacity duration-100 group-focus-within:opacity-100 group-hover:opacity-100"
                >
                  Free reviews run on lightweight models with a tight context
                  window — Sonnet reads deeper and covers more of the diff.
                </span>
              </span>
            </div>
          </div>

          {visibility === "private" ? (
            <div className="animate-fade-up mt-3">
              <input
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value.trim())}
                required
                placeholder="GitHub personal access token (ghp_…)"
                aria-label="GitHub personal access token"
                className={INPUT_CLASS}
              />
              <p className="mt-1.5 text-[11.5px] text-faint">
                Needs the <span className="font-mono">repo</span> scope —{" "}
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo"
                  target="_blank"
                  rel="noreferrer"
                  className="text-link no-underline hover:underline"
                >
                  create one
                </a>
                . Used in-memory for this request only, never stored.
              </p>
            </div>
          ) : null}

          {premium ? (
            <div className="animate-fade-up mt-3">
              <input
                type="password"
                value={premiumKey}
                onChange={(e) => setPremiumKey(e.target.value)}
                required
                placeholder="Anthropic API key (sk-ant-…)"
                aria-label="Anthropic API key"
                className={INPUT_CLASS}
              />
              <p className="mt-1.5 text-[11.5px] text-faint">
                Sent with this request only — never stored or logged.
              </p>
            </div>
          ) : null}
        </form>

        <p className="mt-3 text-[11.5px] text-faint">
          Reviews pull requests with up to {MAX_CHANGED_FILES} changed files.
        </p>
      </div>
    </div>
  );
}
