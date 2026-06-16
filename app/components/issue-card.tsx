import { memo } from "react";
import type { Issue } from "@/lib/review/issue";

const SEVERITY_STYLES: Record<Issue["severity"], string> = {
  error: "bg-red-100 text-red-800 ring-red-300",
  warning: "bg-amber-100 text-amber-800 ring-amber-300",
  nit: "bg-sky-100 text-sky-800 ring-sky-300",
  suggestion: "bg-zinc-100 text-zinc-700 ring-zinc-300",
};

export const IssueCard = memo(function IssueCard({ issue }: { issue: Issue }) {
  const lineRange =
    issue.lineEnd !== issue.lineStart
      ? `${issue.lineStart}–${issue.lineEnd}`
      : `${issue.lineStart}`;

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium uppercase ring-1 ring-inset ${
            SEVERITY_STYLES[issue.severity]
          }`}
        >
          {issue.severity}
        </span>
        <h3 className="font-medium text-zinc-900">{issue.title}</h3>
      </div>

      <div className="mt-1 font-mono text-xs text-zinc-500">
        {issue.file}:{lineRange}
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
        {issue.body}
      </p>

      {issue.suggestion ? (
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-zinc-800 ring-1 ring-inset ring-zinc-200">
          {issue.suggestion}
        </pre>
      ) : null}
    </article>
  );
});
