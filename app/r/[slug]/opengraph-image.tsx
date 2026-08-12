import { ImageResponse } from "next/og";
import { getReview, isReviewSlug } from "@/lib/db/reviews";
import type { ReviewRow } from "@/lib/db/schema";
import { logger } from "@/lib/log";
import { BrandCard, SeverityCard } from "@/app/og/cards";
import { loadOgFonts } from "@/app/og/load-fonts";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "AI PR Reviewer";
export const revalidate = 3600;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let review: ReviewRow | null = null;
  try {
    if (isReviewSlug(slug)) review = await getReview(slug);
  } catch (e) {
    logger.warn({ err: e, slug }, "og image fell back to the brand card");
  }

  const fonts = await loadOgFonts();

  return new ImageResponse(
    review ? <SeverityCard review={review} /> : <BrandCard />,
    { ...size, fonts },
  );
}
