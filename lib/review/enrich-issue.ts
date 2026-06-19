import type { GithubAccess } from "@/lib/github/octokit";
import type { ModelIssue } from "./model-issue.schema";
import type { Issue, CodeLine } from "./issue";
import type { RepoContext } from "@/lib/github/repo-context";
import { parseUnifiedDiff } from "@/lib/github/diff";
import { createHash } from "node:crypto";

const WINDOW = 3;

function normalizeModelText(s: string): string {
  return s
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ");
}

function sliceFromDiff(patch: string, issue: ModelIssue): CodeLine[] | null {
  const inRange = (n: number | null): boolean =>
    n !== null && n >= issue.line_start && n <= issue.line_end;

  const hunk = parseUnifiedDiff(patch).find(
    ({ newStart, newEnd }) =>
      newStart <= issue.line_end && newEnd >= issue.line_start
  );
  if (!hunk) return null;

  const targetIdxs = hunk.lines.flatMap((line, i) =>
    inRange(line.newLineno) ? [i] : []
  );

  const [start, end] =
    targetIdxs.length > 0
      ? [
          Math.max(0, targetIdxs[0] - WINDOW),
          Math.min(
            hunk.lines.length,
            targetIdxs[targetIdxs.length - 1] + WINDOW + 1
          ),
        ]
      : [0, hunk.lines.length];

  return hunk.lines.slice(start, end).map((line) => ({
    lineno: line.newLineno,
    content: line.content,
    kind: line.kind,
    target: inRange(line.newLineno),
  }));
}

async function buildCodeLines(
  gh: GithubAccess,
  issue: ModelIssue
): Promise<CodeLine[]> {
  try {
    const patch = await gh.getDiff(issue.file);
    if (!patch) return [];
    return sliceFromDiff(patch, issue) ?? [];
  } catch (e) {
    console.warn("[enrichIssue] codeLines → []:", issue.file, e);
    return [];
  }
}

export async function enrichIssue(
  gh: GithubAccess,
  repo: RepoContext,
  issue: ModelIssue
): Promise<Issue> {
  const codeLines = await buildCodeLines(gh, issue);

  const id = createHash("sha256")
    .update(
      [issue.file, issue.line_start, issue.line_end, issue.title].join("\0")
    )
    .digest("hex");

  return {
    id,
    severity: issue.severity,
    title: issue.title,
    body: normalizeModelText(issue.body),
    suggestion: issue.suggestion
      ? normalizeModelText(issue.suggestion)
      : undefined,
    file: issue.file,
    lineStart: issue.line_start,
    lineEnd: issue.line_end,
    blobUrl: `https://github.com/${repo.owner}/${repo.repo}/blob/${repo.headSha}/${issue.file}#L${issue.line_start}-L${issue.line_end}`,
    // TODO: ext→Shiki-lang таблица + валидный fallback (с UI, Блок 3 — нужен список bundledLanguages)
    language: issue.file.split(".").pop() || "text",
    codeLines,
  };
}
