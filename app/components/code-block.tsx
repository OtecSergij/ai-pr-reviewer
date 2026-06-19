"use client";

import { useEffect, useState } from "react";
import type { ThemedToken } from "shiki";
import type { CodeLine } from "@/lib/review/issue";
import { CODE_LINE_STYLES, TARGET_ACCENT } from "./review-theme";
import { highlightCode } from "@/lib/highlight/highlighter";

type CodeBlockProps = {
  codeLines: CodeLine[];
  language: string;
  fileName: string;
  rangeLabel: string;
};

const TOKEN_CACHE = new Map<string, ThemedToken[][]>();

function cacheKey(language: string, codeLines: CodeLine[]): string {
  return `${language}\n${codeLines.map((line) => line.content).join("\n")}`;
}

export function CodeBlock({
  codeLines,
  language,
  fileName,
  rangeLabel,
}: CodeBlockProps) {
  const key = cacheKey(language, codeLines);
  const [tokenLines, setTokenLines] = useState<ThemedToken[][] | null>(
    () => TOKEN_CACHE.get(key) ?? null
  );

  useEffect(() => {
    if (TOKEN_CACHE.has(key)) return;
    let cancelled = false;
    const code = codeLines.map((line) => line.content).join("\n");
    highlightCode(code, language)
      .then((tokens) => {
        TOKEN_CACHE.set(key, tokens);
        if (!cancelled) setTokenLines(tokens);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, codeLines, language]);

  return (
    <div className="mx-[18px] mt-3 overflow-hidden rounded-lg border border-[#d8dee4]">
      <div className="flex items-center gap-2 border-b border-[#d8dee4] bg-[#f6f8fa] px-3 py-1.5 font-mono text-[11px] text-muted">
        <span>{fileName}</span>
        <span className="opacity-60">{rangeLabel}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-max">
          {codeLines.map((line, i) => {
            const style = CODE_LINE_STYLES[line.kind];
            const tokens = tokenLines?.[i];
            return (
              <div
                key={i}
                className="flex w-full"
                style={{
                  backgroundColor: style.bg,
                  borderLeft: `3px solid ${
                    line.target ? TARGET_ACCENT : "transparent"
                  }`,
                }}
              >
                <span className="shrink-0 basis-[42px] select-none pr-2.5 text-right font-mono text-[11.5px] leading-[21px] text-faint">
                  {line.lineno ?? ""}
                </span>
                <span
                  className="shrink-0 basis-4 select-none text-center font-mono text-[11.5px] leading-[21px]"
                  style={{ color: style.signColor }}
                >
                  {style.sign}
                </span>
                <span className="whitespace-pre pr-4 font-mono text-[11.5px] leading-[21px] text-[#1f2328]">
                  {line.content === ""
                    ? " "
                    : tokens
                    ? tokens.map((token, ti) => (
                        <span key={ti} style={{ color: token.color }}>
                          {token.content}
                        </span>
                      ))
                    : line.content}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
