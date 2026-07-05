import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { reviews, type ReviewRow } from "@/lib/db/schema";
import type { Issue } from "@/lib/review/issue";

const SLUG_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SLUG_LENGTH = 11;
const SLUG_RE = new RegExp(`^[0-9A-Za-z]{${SLUG_LENGTH}}$`);
const SAVE_TIMEOUT_MS = 2_000;

export type ReviewIdentity = {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
};

export function reviewSlug(id: ReviewIdentity): string {
  const canonical = `${id.owner.toLowerCase()}/${id.repo.toLowerCase()}#${id.prNumber}@${id.headSha.toLowerCase()}`;
  let n = createHash("sha256").update(canonical).digest().readBigUInt64BE(0);
  let slug = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug = SLUG_ALPHABET[Number(n % 62n)] + slug;
    n /= 62n;
  }
  return slug;
}

export function isReviewSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

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
