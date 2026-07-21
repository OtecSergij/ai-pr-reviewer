import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getReview, isReviewSlug } from "@/lib/db/reviews";
import { IssueCard } from "@/app/components/issue-card";
import { SEVERITY_STYLES, severityPills } from "@/app/components/review-theme";

const loadReview = cache(async (slug: string) =>
  isReviewSlug(slug) ? getReview(slug) : null
);

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const review = await loadReview(slug);
  if (!review) return {};
  const title = `AI review — ${review.owner}/${review.repo}#${review.prNumber}`;
  const description = review.prTitle;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharedReviewPage({ params }: Props) {
  const { slug } = await params;
  const review = await loadReview(slug);
  if (!review) notFound();

  const pills = severityPills(review.issues);

  const n = review.issues.length;
  const prUrl = `https://github.com/${review.owner}/${review.repo}/pull/${review.prNumber}`;

  return (
    <div className="flex min-h-screen justify-center px-5 pb-[60px] pt-[50px]">
      <div className="w-full max-w-[820px]">
        <Link href="/" className="flex w-fit items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-ink font-mono text-[12px] font-semibold text-white">
            PR
          </div>
          <div className="text-[18px] font-bold tracking-[-0.02em] text-ink">
            AI PR Reviewer
          </div>
        </Link>

        <div className="mt-6 rounded-xl border border-border bg-white p-[18px]">
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[12px] text-link hover:underline"
          >
            {review.owner}/{review.repo} #{review.prNumber} ↗
          </a>
          <h1 className="mt-1.5 text-[18px] font-bold leading-[1.4] tracking-[-0.01em] text-ink">
            {review.prTitle}
          </h1>
          <div className="mt-2 text-[13px] text-muted">
            Found {n} issue{n === 1 ? "" : "s"}.
          </div>

          {pills.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {pills.map((p) => (
                <div
                  key={p.severity}
                  className="rounded-full border px-3 py-1 text-[12px] font-semibold"
                  style={{
                    backgroundColor: SEVERITY_STYLES[p.severity].bg,
                    color: SEVERITY_STYLES[p.severity].color,
                    borderColor: SEVERITY_STYLES[p.severity].border,
                  }}
                >
                  {p.label}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 font-mono text-[11px] text-faint">
            {review.provider} · head {review.headSha.slice(0, 7)} ·{" "}
            {review.createdAt.toISOString().slice(0, 10)}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {review.issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} />
          ))}
        </div>

        {n === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border p-7 text-center text-[13px] text-subtle">
            The agent finished this review without reporting any issues.
          </div>
        ) : null}

        <p className="mt-5 text-[12px] leading-[1.5] text-faint">
          AI-generated review — may contain mistakes. Every issue links to the
          exact lines on GitHub so you can verify.
        </p>
      </div>
    </div>
  );
}
