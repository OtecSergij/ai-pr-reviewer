import type { BundledLanguage, BundledTheme } from "shiki/bundle/web";
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

const SUPPORTED = new Set<string>(PRELOAD_LANGS);

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  sql: "sql",
};

function resolveLang(raw: string): BundledLanguage | SpecialLanguage {
  const key = (raw || "").toLowerCase();
  const candidate = EXT_TO_LANG[key] ?? key;
  return SUPPORTED.has(candidate) ? (candidate as BundledLanguage) : "text";
}

async function loadHighlighter() {
  const shiki = await import("shiki/bundle/web");
  return shiki.getSingletonHighlighter({
    themes: [THEME],
    langs: PRELOAD_LANGS,
  });
}

let highlighterPromise: ReturnType<typeof loadHighlighter> | null = null;

function getHighlighter() {
  highlighterPromise ??= loadHighlighter();
  return highlighterPromise;
}

export async function highlightCode(
  code: string,
  rawLang: string
): Promise<ThemedToken[][]> {
  const highlighter = await getHighlighter();
  const { tokens } = highlighter.codeToTokens(code, {
    lang: resolveLang(rawLang),
    theme: THEME,
  });
  return tokens;
}
