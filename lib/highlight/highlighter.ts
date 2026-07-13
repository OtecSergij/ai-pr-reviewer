import type { BundledLanguage, BundledTheme } from "shiki/bundle/full";
import type { SpecialLanguage, ThemedToken } from "shiki";

const THEME: BundledTheme = "github-light";

const PRELOAD_LANGS: BundledLanguage[] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "markdown",
  "css",
  "scss",
  "html",
  "yaml",
  "bash",
  "python",
  "sql",
];

const EXT_TO_LANG: Record<string, string> = {
  htm: "html",
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  ex: "elixir",
  exs: "elixir",
};

type ShikiBundle = typeof import("shiki/bundle/full");
type ShikiHighlighter = Awaited<
  ReturnType<ShikiBundle["getSingletonHighlighter"]>
>;

type LoadedShiki = {
  highlighter: ShikiHighlighter;
  bundledLanguages: ShikiBundle["bundledLanguages"];
};

let shikiPromise: Promise<LoadedShiki> | null = null;

function getShiki(): Promise<LoadedShiki> {
  shikiPromise ??= import("shiki/bundle/full").then(async (shiki) => ({
    highlighter: await shiki.getSingletonHighlighter({
      themes: [THEME],
      langs: PRELOAD_LANGS,
    }),
    bundledLanguages: shiki.bundledLanguages,
  }));
  return shikiPromise;
}

const langLoads = new Map<string, Promise<boolean>>(
  PRELOAD_LANGS.map((lang) => [lang, Promise.resolve(true)])
);

function ensureLangLoaded(
  highlighter: ShikiHighlighter,
  lang: BundledLanguage
): Promise<boolean> {
  let loaded = langLoads.get(lang);
  if (!loaded) {
    loaded = highlighter.loadLanguage(lang).then(
      () => true,
      () => false
    );
    langLoads.set(lang, loaded);
  }
  return loaded;
}

async function resolveLang(
  shiki: LoadedShiki,
  raw: string
): Promise<BundledLanguage | SpecialLanguage> {
  const key = (raw || "").toLowerCase();
  const candidate = EXT_TO_LANG[key] ?? key;
  if (!Object.hasOwn(shiki.bundledLanguages, candidate)) return "text";
  const lang = candidate as BundledLanguage;
  return (await ensureLangLoaded(shiki.highlighter, lang)) ? lang : "text";
}

export async function highlightCode(
  code: string,
  rawLang: string
): Promise<ThemedToken[][]> {
  const shiki = await getShiki();
  const { tokens } = shiki.highlighter.codeToTokens(code, {
    lang: await resolveLang(shiki, rawLang),
    theme: THEME,
  });
  return tokens;
}
