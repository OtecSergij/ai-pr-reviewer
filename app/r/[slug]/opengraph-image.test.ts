import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import type { ReviewRow } from "@/lib/db/schema";

const getReview = vi.fn<(slug: string) => Promise<ReviewRow | null>>();
const warn = vi.fn();

vi.mock("@/lib/db/reviews", async () => {
  const { isReviewSlug } = await import("@/lib/db/slug");
  return { isReviewSlug, getReview: (slug: string) => getReview(slug) };
});

vi.mock("@/lib/log", () => ({ logger: { warn: (...args: unknown[]) => warn(...args) } }));

vi.mock("@/app/og/load-fonts", () => ({ loadOgFonts: async () => [] }));

vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(
      readonly element: ReactElement,
      readonly options: unknown
    ) {}
  },
}));

const { default: Image } = await import("./opengraph-image");
const { BrandCard, SeverityCard } = await import("@/app/og/cards");

const SLUG = "0T6rLUpSmg3";

const row: ReviewRow = {
  slug: SLUG,
  owner: "vercel",
  repo: "next.js",
  prNumber: 123,
  headSha: "abcdef0",
  prTitle: "Fix the thing",
  issues: [],
  modelId: "gemini-2.5-flash",
  createdAt: new Date("2026-08-12T00:00:00Z"),
};

async function render(slug: string) {
  const response = (await Image({
    params: Promise.resolve({ slug }),
  })) as unknown as { element: ReactElement };
  return response.element;
}

describe("share-page OG image", () => {
  beforeEach(() => {
    getReview.mockReset();
    warn.mockReset();
  });

  it("renders the review card when the row is found", async () => {
    getReview.mockResolvedValue(row);
    expect((await render(SLUG)).type).toBe(SeverityCard);
  });

  it("falls back to the brand card when the database is unreachable", async () => {
    getReview.mockRejectedValue(new Error("connection refused"));
    expect((await render(SLUG)).type).toBe(BrandCard);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("falls back to the brand card for an unknown slug", async () => {
    getReview.mockResolvedValue(null);
    expect((await render(SLUG)).type).toBe(BrandCard);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not query the database for a malformed slug", async () => {
    expect((await render("not-a-slug")).type).toBe(BrandCard);
    expect(getReview).not.toHaveBeenCalled();
  });
});
