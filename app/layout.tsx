import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { connection } from "next/server";
import { env } from "@/lib/env";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

const title = "AI PR Reviewer";
const description =
  "Paste a GitHub pull request link — an AI agent walks the repository, reads the changes in context, and streams back a review.";

export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL),
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
    <html
      lang="en"
      className={`${instrumentSans.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
