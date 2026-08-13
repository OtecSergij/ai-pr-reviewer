import type { Metadata } from "next";
import { connection } from "next/server";
import { env, DEFAULT_APP_URL } from "@/lib/env";
import { FONT_VARIABLES } from "./fonts";
import "./globals.css";

const title = "AI PR Reviewer";
const description =
  "Paste a GitHub pull request link — an AI agent walks the repository, reads the changes in context, and streams back a review.";

export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL || DEFAULT_APP_URL),
  title,
  description,
  openGraph: {
    title,
    description,
    siteName: "AI PR Reviewer",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  return (
    <html lang="en" className={FONT_VARIABLES}>
      <body>{children}</body>
    </html>
  );
}
