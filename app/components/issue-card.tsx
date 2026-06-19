"use client";

import { memo } from "react";
import { basename } from "@/lib/path";
import type { Issue } from "@/lib/review/issue";
import { SEVERITY_STYLES } from "./review-theme";
import { CodeBlock } from "./code-block";
import { CopyButton } from "./copy-button";
import { Markdown, MarkdownInline } from "./markdown";

export const IssueCard = memo(function IssueCard({ issue }: { issue: Issue }) {
  const sev = SEVERITY_STYLES[issue.severity];
  const fileName = basename(issue.file);
  const rangeLabel = `L${issue.lineStart}–L${issue.lineEnd}`;
  const fileLabel = `${issue.file}:${issue.lineStart}–${issue.lineEnd}`;

  return (
    <article className="animate-card-in overflow-hidden rounded-xl border border-border bg-white pb-4">
      <div className="px-[18px] pt-4">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.05em]"
            style={{
              color: sev.color,
              backgroundColor: sev.bg,
              borderColor: sev.border,
            }}
          >
            {sev.label}
          </span>
          <h3 className="text-[15px] font-semibold leading-[1.45] tracking-[-0.005em] text-ink">
            <MarkdownInline>{issue.title}</MarkdownInline>
          </h3>
        </div>
        <a
          href={issue.blobUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 font-mono text-[12px] text-link hover:underline"
        >
          {fileLabel} ↗
        </a>
      </div>

      {issue.codeLines.length > 0 ? (
        <CodeBlock
          codeLines={issue.codeLines}
          language={issue.language}
          fileName={fileName}
          rangeLabel={rangeLabel}
        />
      ) : null}

      <div className="px-[18px] pb-0.5 pt-3.5">
        <Markdown>{issue.body}</Markdown>
      </div>

      {issue.suggestion ? <Suggestion text={issue.suggestion} /> : null}
    </article>
  );
});

function Suggestion({ text }: { text: string }) {
  return (
    <div className="mx-[18px] mt-1 overflow-hidden rounded-lg border border-[#cce8d4]">
      <div className="flex items-center justify-between border-b border-[#cce8d4] bg-[#f0fbf3] py-1.5 pl-3 pr-2">
        <div className="text-[11.5px] font-semibold text-[#1a7f37]">
          Suggested change
        </div>
        <CopyButton
          text={text}
          className="rounded-md border border-[#cce8d4] bg-white px-2.5 py-[3px] text-[11px] font-semibold text-[#1a7f37]"
        />
      </div>
      <pre className="m-0 overflow-x-auto bg-white px-3.5 py-3 font-mono text-[11.5px] leading-[1.6] text-[#1f2328]">
        {text}
      </pre>
    </div>
  );
}
