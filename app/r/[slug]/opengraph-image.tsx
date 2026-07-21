import { ImageResponse } from "next/og";
import { getReview, isReviewSlug } from "@/lib/db/reviews";
import { BrandCard, SeverityCard } from "@/app/og/cards";
import { loadOgFonts } from "@/app/og/load-fonts";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "AI PR Reviewer";
export const revalidate = 86400;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const review = isReviewSlug(slug) ? await getReview(slug) : null;
  const fonts = await loadOgFonts();

  return new ImageResponse(
    review ? <SeverityCard review={review} /> : <BrandCard />,
    { ...size, fonts }
  );
}
