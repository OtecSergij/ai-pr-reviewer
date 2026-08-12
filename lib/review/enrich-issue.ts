import type { GithubAccess } from "@/lib/github/octokit";
import type { ModelIssue } from "./model-issue.schema";
import type { Issue, CodeLine } from "./issue";
import type { RepoContext } from "@/lib/github/repo-context";
import { parseUnifiedDiff } from "@/lib/github/diff";
import { basename } from "@/lib/path";
import { createHash } from "node:crypto";
import type { Logger } from "pino";

const WINDOW = 3;

export function issueLanguage(file: string): string {
  return basename(file).split(".").pop() || "text";
}

function normalizeModelText(s: string): string {
  return s
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ");
}

const FENCE_CHARS = ["`", "~"];

type Fence = { char: string; length: number };

function openingFence(line: string): Fence | null {
  const char = FENCE_CHARS.find((c) => line.startsWith(c.repeat(3)));
  if (!char) return null;

  let length = 0;
  while (line[length] === char) length += 1;

  const info = line.slice(length);
  return info.includes(char) ? null : { char, length };
}

function isClosingFence(line: string, fence: Fence): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= fence.length &&
    [...trimmed].every((char) => char === fence.char)
  );
}

function unwrapCodeFence(text: string): string {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return text;

  const fence = openingFence(lines[0]);
  if (!fence) return text;

  const closingIdx = lines.findIndex(
    (line, i) => i > 0 && isClosingFence(line, fence),
  );
  if (closingIdx !== lines.length - 1) return text;

  return lines.slice(1, -1).join("\n");
}

export function normalizeSuggestion(s: string): string {
  return unwrapCodeFence(normalizeModelText(s));
}

function sliceFromDiff(patch: string, issue: ModelIssue): CodeLine[] | null {
  const inRange = (n: number | null): boolean =>
    n !== null && n >= issue.line_start && n <= issue.line_end;

  const hunk = parseUnifiedDiff(patch).find(
    ({ newStart, newEnd }) =>
      newStart <= issue.line_end && newEnd >= issue.line_start,
  );
  if (!hunk) return null;

  const targetIdxs = hunk.lines.flatMap((line, i) =>
    inRange(line.newLineno) ? [i] : [],
  );

  const [start, end] =
    targetIdxs.length > 0
      ? [
          Math.max(0, targetIdxs[0] - WINDOW),
          Math.min(
            hunk.lines.length,
            targetIdxs[targetIdxs.length - 1] + WINDOW + 1,
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

type CodeLinesResult = {
  codeLines: CodeLine[];
  patchFound: boolean;
  hunkMatched: boolean;
};

const noCodeLines = (): CodeLinesResult => ({
  codeLines: [],
  patchFound: false,
  hunkMatched: false,
});

async function buildCodeLines(
  gh: GithubAccess,
  issue: ModelIssue,
  log: Logger,
): Promise<CodeLinesResult> {
  try {
    const patch = await gh.getDiff(issue.file);
    if (!patch) return noCodeLines();

    const slice = sliceFromDiff(patch, issue);
    return {
      codeLines: slice ?? [],
      patchFound: true,
      hunkMatched: slice !== null,
    };
  } catch (e) {
    log.warn({ err: e, file: issue.file }, "buildCodeLines failed");
    return noCodeLines();
  }
}

export async function enrichIssue(
  gh: GithubAccess,
  repo: RepoContext,
  issue: ModelIssue,
  log: Logger,
): Promise<Issue> {
  const { codeLines, patchFound, hunkMatched } = await buildCodeLines(
    gh,
    issue,
    log,
  );

  const id = createHash("sha256")
    .update(
      [issue.file, issue.line_start, issue.line_end, issue.title].join("\0"),
    )
    .digest("hex");

  log.info(
    {
      id,
      file: issue.file,
      lineStart: issue.line_start,
      lineEnd: issue.line_end,
      severity: issue.severity,
      patchFound,
      hunkMatched,
      codeLines: codeLines.length,
    },
    "issue enriched",
  );

  return {
    id,
    severity: issue.severity,
    title: issue.title,
    body: normalizeModelText(issue.body),
    suggestion: issue.suggestion
      ? normalizeSuggestion(issue.suggestion)
      : undefined,
    file: issue.file,
    lineStart: issue.line_start,
    lineEnd: issue.line_end,
    blobUrl: `https://github.com/${repo.owner}/${repo.repo}/blob/${repo.headSha}/${issue.file}#L${issue.line_start}-L${issue.line_end}`,
    language: issueLanguage(issue.file),
    codeLines,
  };
}
