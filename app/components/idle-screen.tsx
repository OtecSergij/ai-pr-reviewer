"use client";

import { useState } from "react";
import type { ReviewRunOptions } from "@/app/hooks/review/use-review";

type IdleScreenProps = {
  url: string;
  onUrlChange: (url: string) => void;
  visibility: "public" | "private";
  onVisibilityChange: (v: "public" | "private") => void;
  onStart: (options: ReviewRunOptions) => void;
};

const INPUT_CLASS =
  "h-[42px] w-full min-w-0 rounded-[9px] border border-border-strong bg-[#fafafa] px-3.5 font-mono text-[13px] text-ink outline-none focus:border-[#6366f1] focus:bg-white focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]";

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
      anthropicKey: premium && premiumKey.trim() ? premiumKey.trim() : undefined,
      githubPat:
        visibility === "private" && pat.trim() ? pat.trim() : undefined,
    });
  }

  return (
    <div className="flex min-h-screen justify-center px-6 pb-[60px] pt-[130px]">
      <div className="animate-fade-up w-full max-w-[620px]">
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
          <div className="flex gap-2.5">
            <input
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
              aria-label="GitHub pull request URL"
              className={INPUT_CLASS}
            />
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

            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
              <input
                type="checkbox"
                checked={premium}
                onChange={(e) => setPremium(e.target.checked)}
                className="m-0 h-3.5 w-3.5 accent-ink"
              />
              Use Claude Sonnet — bring your own API key
            </label>
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

        <p className="mt-4 text-[12px] leading-[1.5] text-faint">
          AI-generated review — may contain mistakes. Every issue links to the
          exact lines on GitHub so you can verify.
        </p>
      </div>
    </div>
  );
}
