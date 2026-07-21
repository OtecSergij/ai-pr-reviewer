import { readFile } from "node:fs/promises";
import { join } from "node:path";

type OgFont = {
  name: string;
  data: Buffer;
  weight: 400 | 600 | 700;
  style: "normal";
};

const FONT_DIR = join(process.cwd(), "app", "og", "fonts");

export async function loadOgFonts(): Promise<OgFont[]> {
  const [sansRegular, sansBold, monoSemiBold] = await Promise.all([
    readFile(join(FONT_DIR, "InstrumentSans-Regular.ttf")),
    readFile(join(FONT_DIR, "InstrumentSans-Bold.ttf")),
    readFile(join(FONT_DIR, "JetBrainsMono-SemiBold.ttf")),
  ]);

  return [
    { name: "Instrument Sans", data: sansRegular, weight: 400, style: "normal" },
    { name: "Instrument Sans", data: sansBold, weight: 700, style: "normal" },
    { name: "JetBrains Mono", data: monoSemiBold, weight: 600, style: "normal" },
  ];
}
