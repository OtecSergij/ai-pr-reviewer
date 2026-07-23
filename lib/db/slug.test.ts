import { describe, it, expect } from "vitest";
import { reviewSlug, isReviewSlug, type ReviewIdentity } from "./slug";

const id: ReviewIdentity = {
  owner: "Vercel",
  repo: "Next.js",
  prNumber: 123,
  headSha: "ABCDEF0",
};

describe("reviewSlug", () => {
  it("pins the exact slug for known identities (guards against algorithm drift)", () => {
    expect(reviewSlug(id)).toBe("0T6rLUpSmg3");
    expect(reviewSlug({ ...id, prNumber: 124 })).toBe("936LEENkrhc");
  });

  it("is deterministic for the same identity", () => {
    expect(reviewSlug(id)).toBe(reviewSlug(id));
  });

  it("lowercases owner, repo and sha before hashing", () => {
    expect(reviewSlug(id)).toBe(
      reviewSlug({
        owner: "vercel",
        repo: "next.js",
        prNumber: 123,
        headSha: "abcdef0",
      })
    );
  });

  it("changes when the PR number changes", () => {
    expect(reviewSlug(id)).not.toBe(reviewSlug({ ...id, prNumber: 124 }));
  });

  it("changes when the head sha changes", () => {
    expect(reviewSlug(id)).not.toBe(reviewSlug({ ...id, headSha: "0000000" }));
  });

  it("produces an 11-char base62 slug that passes isReviewSlug", () => {
    const slug = reviewSlug(id);
    expect(slug).toHaveLength(11);
    expect(isReviewSlug(slug)).toBe(true);
  });
});

describe("isReviewSlug", () => {
  it("accepts an 11-char alphanumeric string", () => {
    expect(isReviewSlug("aB3dEf0GhiJ")).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isReviewSlug("short")).toBe(false);
    expect(isReviewSlug("waytoolongslug123")).toBe(false);
  });

  it("rejects non-alphanumeric characters", () => {
    expect(isReviewSlug("aB3dEf0Gh-J")).toBe(false);
    expect(isReviewSlug("aB3dEf0Gh J")).toBe(false);
  });
});
