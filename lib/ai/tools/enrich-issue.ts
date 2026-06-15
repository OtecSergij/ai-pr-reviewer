import type { GithubAccess } from "@/lib/github/octokit";
import type { ModelIssue } from "@/lib/ai/schema/review-stream";
import type { IssueData, CodeLine } from "@/lib/issue";
import type { RepoContext } from "@/lib/github/repo-context";
import { parseUnifiedDiff } from "@/lib/github/diff";
import { createHash } from "node:crypto";

const WINDOW = 3;

function sliceFromDiff(patch: string, issue: ModelIssue): CodeLine[] | null {
  const hunk = parseUnifiedDiff(patch).find(
    ({ newStart, newEnd }) =>
      newEnd >= issue.line_end && newStart <= issue.line_start
  );
  if (!hunk) return null;

  const firstIdx = hunk.lines.findIndex(
    ({ newLineno }) => newLineno === issue.line_start
  );
  const lastIdx = hunk.lines.findIndex(
    ({ newLineno }) => newLineno === issue.line_end
  );

  const windowLines = hunk.lines.slice(
    Math.max(0, firstIdx - WINDOW),
    lastIdx + WINDOW + 1
  );

  return windowLines.map((line) => ({
    lineno: line.newLineno,
    content: line.content,
    kind: line.kind,
    target:
      line.newLineno !== null &&
      line.newLineno >= issue.line_start &&
      line.newLineno <= issue.line_end,
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
    console.warn("[enrichIssue] code_lines → []:", issue.file, e);
    return [];
  }
}

export async function enrichIssue(
  gh: GithubAccess,
  repo: RepoContext,
  issue: ModelIssue
): Promise<IssueData> {
  const code_lines = await buildCodeLines(gh, issue);

  const id = createHash("sha256")
    .update(
      [issue.file, issue.line_start, issue.line_end, issue.title].join("\0")
    )
    .digest("hex");

  return {
    id,
    severity: issue.severity,
    title: issue.title,
    body: issue.body,
    suggestion: issue.suggestion,
    file: issue.file,
    line_start: issue.line_start,
    line_end: issue.line_end,
    blob_url: `https://github.com/${repo.owner}/${repo.repo}/blob/${repo.headSha}/${issue.file}#L${issue.line_start}-L${issue.line_end}`,
    // TODO: ext→Shiki-lang таблица + валидный fallback (с UI, Блок 3 — нужен список bundledLanguages)
    language: issue.file.split(".").pop() || "text",
    code_lines,
  };
}
