import { createHash } from "node:crypto";

const SLUG_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SLUG_LENGTH = 11;
const SLUG_RE = new RegExp(`^[0-9A-Za-z]{${SLUG_LENGTH}}$`);

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
