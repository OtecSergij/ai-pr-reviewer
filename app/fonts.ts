import { Instrument_Sans, JetBrains_Mono } from "next/font/google";

export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const FONT_VARIABLES = `${instrumentSans.variable} ${jetbrainsMono.variable}`;
