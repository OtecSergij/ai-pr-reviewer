import { ImageResponse } from "next/og";
import { BrandCard } from "@/app/og/cards";
import { loadOgFonts } from "@/app/og/load-fonts";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "AI PR Reviewer";

export default async function Image() {
  const fonts = await loadOgFonts();
  return new ImageResponse(<BrandCard />, { ...size, fonts });
}
