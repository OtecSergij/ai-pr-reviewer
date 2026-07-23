import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { reviews, type ReviewRow } from "@/lib/db/schema";
import type { Issue } from "@/lib/review/issue";
import { reviewSlug, isReviewSlug, type ReviewIdentity } from "./slug";

export { reviewSlug, isReviewSlug };
export type { ReviewIdentity };

const SAVE_TIMEOUT_MS = 2_000;

export async function saveReview(
  input: ReviewIdentity & {
    prTitle: string;
    issues: Issue[];
    provider: string;
  }
): Promise<string> {
  const slug = reviewSlug(input);
  await Promise.race([
    db
      .insert(reviews)
      .values({
        slug,
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        headSha: input.headSha,
        prTitle: input.prTitle,
        issues: input.issues,
        provider: input.provider,
      })
      .onConflictDoUpdate({
        target: reviews.slug,
        set: {
          prTitle: input.prTitle,
          issues: input.issues,
          provider: input.provider,
          createdAt: sql`now()`,
        },
      }),
    timeoutAfter(SAVE_TIMEOUT_MS),
  ]);
  return slug;
}

export async function getReview(slug: string): Promise<ReviewRow | null> {
  const [row] = await db
    .select()
    .from(reviews)
    .where(eq(reviews.slug, slug))
    .limit(1);
  return row ?? null;
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(reject, ms, new Error("review save timed out"));
  });
}
