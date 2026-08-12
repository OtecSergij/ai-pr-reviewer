import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { db } from "@/lib/db/client";
import { reviews, type ReviewRow } from "@/lib/db/schema";
import type { Issue } from "@/lib/review/issue";
import { reviewSlug, isReviewSlug, type ReviewIdentity } from "./slug";

export { isReviewSlug };

export async function saveReview(
  input: ReviewIdentity & {
    prTitle: string;
    issues: Issue[];
    modelId: string;
  },
  log: Logger
): Promise<string> {
  const startedAt = Date.now();
  const slug = reviewSlug(input);
  await db
    .insert(reviews)
    .values({
      slug,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      headSha: input.headSha,
      prTitle: input.prTitle,
      issues: input.issues,
      modelId: input.modelId,
    })
    .onConflictDoUpdate({
      target: reviews.slug,
      set: {
        owner: input.owner,
        repo: input.repo,
        prTitle: input.prTitle,
        issues: input.issues,
        modelId: input.modelId,
        createdAt: sql`now()`,
      },
    });

  log.info(
    {
      slug,
      issues: input.issues.length,
      durationMs: Date.now() - startedAt,
    },
    "review saved"
  );

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
