import { GithubAccess, NotFoundError } from "@/lib/github/octokit";
import { GitHubError } from "@/lib/github/error-base";
import type { Issue } from "@/lib/review/issue";
import { tool, UIMessageStreamWriter } from "ai";
import { z } from "zod";
import type { Logger } from "pino";
import { truncateBody } from "./truncate-body";
import { splitPatch } from "./paginate-patch";
import { isGeneratedPath } from "./generated-path";
import { modelIssueSchema } from "@/lib/review/model-issue.schema";
import type { ReviewUIMessage } from "@/lib/review/stream";
import { REVIEW_TOOL_NAMES, type ReviewToolName } from "./tool-names";
import { enrichIssue } from "@/lib/review/enrich-issue";
import type { RepoContext } from "@/lib/github/repo-context";
import {
  MAX_FILE_CONTENTS_BYTES,
  MAX_PARTS_PER_FILE,
  MAX_PART_REPEATS,
  PATCH_READ_BUDGET_CHARS,
} from "@/lib/review/config";

type PartLimitScope = "file" | "run" | "generated" | "repeat";

type PatchPartResult =
  | { status: "no_such_part"; total_parts: number }
  | { status: "part_limit"; scope: PartLimitScope; total_parts: number }
  | {
      patch: string;
      part: number;
      total_parts: number;
      has_more: boolean;
      next_part: number | null;
    };

function outcomeOf(output: unknown): string {
  if (output !== null && typeof output === "object" && "status" in output) {
    return `skipped:${String((output as { status: unknown }).status)}`;
  }
  return "ok";
}

async function runTool<T>(
  log: Logger,
  toolName: ReviewToolName,
  input: unknown,
  execute: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  log.info({ tool: toolName, input }, "tool started");

  try {
    const output = await execute();
    log.info(
      {
        tool: toolName,
        durationMs: Date.now() - startedAt,
        outcome: outcomeOf(output),
      },
      "tool finished"
    );
    return output;
  } catch (e) {
    log.warn(
      {
        err: e,
        tool: toolName,
        durationMs: Date.now() - startedAt,
        outcome: "threw",
      },
      "tool finished"
    );
    throw e;
  }
}

export function createReviewTools(
  gh: GithubAccess,
  UIIssues: Map<string, Issue>,
  repo: RepoContext,
  writer: UIMessageStreamWriter<ReviewUIMessage>,
  log: Logger
) {
  const partRequests = new Map<string, number>();
  const partsPaid = new Set<string>();
  let patchCharsSpent = 0;

  const servePatchPart = (
    filename: string,
    parts: string[],
    part: number
  ): PatchPartResult => {
    const key = `${filename}#${part}`;
    const requests = partRequests.get(key) ?? 0;
    partRequests.set(key, requests + 1);

    const generated = isGeneratedPath(filename);
    const total_parts = parts.length;

    if (requests >= MAX_PART_REPEATS) {
      return { status: "part_limit", scope: "repeat", total_parts };
    }

    if (part < 1 || part > total_parts) {
      return { status: "no_such_part", total_parts };
    }

    if (generated && part > 1) {
      return { status: "part_limit", scope: "generated", total_parts };
    }

    if (part > MAX_PARTS_PER_FILE) {
      return { status: "part_limit", scope: "file", total_parts };
    }

    if (!partsPaid.has(key)) {
      if (patchCharsSpent >= PATCH_READ_BUDGET_CHARS) {
        return { status: "part_limit", scope: "run", total_parts };
      }

      patchCharsSpent += parts[part - 1].length;
      partsPaid.add(key);
    }

    const has_more = part < total_parts;
    const readable =
      has_more &&
      !generated &&
      part < MAX_PARTS_PER_FILE &&
      patchCharsSpent < PATCH_READ_BUDGET_CHARS;

    return {
      patch: parts[part - 1],
      part,
      total_parts,
      has_more,
      next_part: readable ? part + 1 : null,
    };
  };

  const changedPath = async (file: string): Promise<string | null> => {
    const changed = await gh.getFile(file);
    if (changed) return changed.filename;

    const files = await gh.getPRFiles();
    return files.find((f) => f.previousFilename === file)?.filename ?? null;
  };

  return {
    get_pr_metadata: tool({
      description: `Start here to understand the PR's intent and scope before reading diffs. Fields it returns:
title: what the author claims the PR does – check the code against it;
body: author's description of the PR. If body_truncated is true – you see only the start of the body – don't assume it's the full description;
changed_files: number of files touched – use it to gauge review scope;
head_ref – source branch;
base_ref – target branch.`,
      inputSchema: z.object({}),
      execute: (input) =>
        runTool(log, REVIEW_TOOL_NAMES.getPrMetadata, input, async () => {
          const { title, body, changedFiles, headRef, baseRef } =
            await gh.getPRMetadata();
          const truncatedBody = truncateBody(body);

          return {
            title,
            body: truncatedBody.body,
            body_truncated: truncatedBody.bodyTruncated,
            changed_files: changedFiles,
            head_ref: headRef,
            base_ref: baseRef,
          };
        }),
    }),
    get_pr_files_summary: tool({
      description: `Returns the list of changed files with per–file statistics, but not the actual diff – use get_diff(filename) to read the patch. Use it to decide which diffs to read and how much reading each one costs. Fields it returns:
filename: the file's path. It's the identifier you pass to the get_diff and get_file_contents tools;
status: shows whether the file was added, removed, modified or renamed;
additions: number of added lines;
deletions: number of removed lines;
changes: total lines changed (additions + deletions);
diff_parts: how many parts get_diff splits this file's patch into – 1 means a single call gives you the whole patch, 0 means GitHub has no diff for it;
generated: true when the path looks machine-generated (build output like dist/, minified bundles, source maps, lockfiles) – its diff is usually noise rather than a change to review;
previous_filename: old file name, if it was renamed.`,
      inputSchema: z.object({}),
      execute: (input) =>
        runTool(log, REVIEW_TOOL_NAMES.getPrFilesSummary, input, async () => {
          const files = await gh.getPRFiles();

          return {
            files: await Promise.all(
              files.map(async (f) => {
                const patch = await gh.getDiff(f.filename);

                return {
                  filename: f.filename,
                  status: f.status,
                  additions: f.additions,
                  deletions: f.deletions,
                  changes: f.changes,
                  diff_parts: patch ? splitPatch(patch).length : 0,
                  generated: isGeneratedPath(f.filename),
                  previous_filename: f.previousFilename,
                };
              })
            ),
          };
        }),
    }),
    get_diff: tool({
      description: `Return the patch (unified diff) of one changed file. Pass the exact filename from get_pr_files_summary. A large patch is split into parts at hunk boundaries – get_pr_files_summary tells you how many parts a file has in diff_parts. Omit part to get the first one; pass part to read further. Returns { patch, part, total_parts, has_more, next_part } in the success case: has_more says whether parts remain after the one you got, next_part is the number to pass next, and next_part: null means you may not read further and must work with what you have. Reading is budgeted – ask for the next part only when the part you already have is not enough to judge the change. Returns {status} if there is a problem:
not_in_pr – re–check get_pr_files_summary for this path;
no_patch – GitHub serves no diff for this file (it is binary or too big to diff) – get_file_contents may still read it; if that refuses too, skip the file;
no_such_part – there is no such part; total_parts says how many there are;
part_limit – you asked for a part you are not allowed to read; scope says which limit stopped you: file (this file's part allowance), run (the review's overall patch budget), generated (build output – only the first part is served), repeat (you already requested this exact part). Do not retry – judge from what you have already read, and say so if that is not enough.`,
      inputSchema: z.object({
        filename: z.string(),
        part: z.number().int().min(1).optional(),
      }),
      execute: (input) =>
        runTool(log, REVIEW_TOOL_NAMES.getDiff, input, async () => {
          const diff = await gh.getDiff(input.filename);

          if (!diff) {
            const file = await gh.getFile(input.filename);

            if (!file) {
              return {
                status: "not_in_pr",
              };
            } else {
              return {
                status: "no_patch",
              };
            }
          }

          return servePatchPart(
            input.filename,
            splitPatch(diff),
            input.part ?? 1
          );
        }),
    }),
    get_file_contents: tool({
      description: `Returns the full content of a single file at the PR's head state. Call get_file_contents only when the diff alone is insufficient to judge the change — for example, when a referenced symbol is defined outside the diff, or when you need to see how the changed code is used elsewhere in the file. If the change is self-contained and the diff gives you everything you need, do not fetch the file. Returns { content, size } in the success case. Returns {status, reason} if there is a problem:
not_found – the file doesn't exist at the PR head (e.g., deleted in this PR) or the path may be wrong – check get_pr_files_summary for valid paths;
too_large – the file is over the size this tool serves (${MAX_FILE_CONTENTS_BYTES} bytes) or over GitHub's 1 MB blob limit – read the change itself with get_diff, part by part;
unavailable – couldn't read the file; see reason (e.g., the path is a directory – use list_directory).`,
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: (input) =>
        runTool(log, REVIEW_TOOL_NAMES.getFileContents, input, async () => {
          try {
            const { content, size } = await gh.getFileContents({
              path: input.path,
              ref: repo.headSha,
              maxBytes: MAX_FILE_CONTENTS_BYTES,
            });

            if (content === null) {
              return { status: "too_large" };
            }

            return { content, size };
          } catch (e) {
            if (e instanceof NotFoundError) return { status: "not_found" };
            if (e instanceof GitHubError)
              return { status: "unavailable", reason: e.message };
            throw e;
          }
        }),
    }),
    list_directory: tool({
      description: `Returns the list of entries in a passed path at the PR's head state. Use it to understand the structure – e.g., to check whether tests exist for the changed code, or to find related files. Returns {entries} in the success case. Entries is an array of objects with fields:
path: the entry's full path – pass it to get_diff / get_file_contents;
type: one of "file", "dir", "symlink", "submodule".
If there is a problem you will get {status, reason}.
not_found – the path doesn't exist – check get_pr_files_summary for valid paths;
unavailable – couldn't list it; see reason (e.g., the path is a file, not a directory – use get_file_contents).`,
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: (input) =>
        runTool(log, REVIEW_TOOL_NAMES.listDirectory, input, async () => {
          try {
            const entries = await gh.listDirectory({
              path: input.path,
              ref: repo.headSha,
            });

            return {
              entries: entries.map(({ path, type }) => ({
                path,
                type,
              })),
            };
          } catch (e) {
            if (e instanceof NotFoundError) return { status: "not_found" };
            if (e instanceof GitHubError)
              return { status: "unavailable", reason: e.message };
            throw e;
          }
        }),
    }),
    emit_issue: tool({
      description:
        "Report a single code-review issue you found in this PR. Call it once per issue, the moment you have confirmed a problem — do not batch issues for the end, and never write issues as plain text. You provide the location (file + line range) and the explanation; the code snippet is added by the backend, so do not send code. The file must be one this PR changes: an issue about any other path is refused with status not_in_pr. Reporting the same issue twice is safe — the repeat is ignored and the result has duplicate: true, so there is no need to resend it.",
      inputSchema: modelIssueSchema,
      execute: (input) =>
        runTool(
          log,
          REVIEW_TOOL_NAMES.emitIssue,
          {
            file: input.file,
            line_start: input.line_start,
            line_end: input.line_end,
            severity: input.severity,
          },
          async () => {
            const file = await changedPath(input.file);

            if (!file) {
              log.info(
                { file: input.file, severity: input.severity },
                "issue rejected: file not changed by this PR"
              );

              return {
                status: "not_in_pr",
                reason: `${input.file} is not among the files this PR changes, so the issue was not recorded. Call get_pr_files_summary and report against one of the exact paths it lists — resending the same path will be refused again.`,
              };
            }

            const data = await enrichIssue(gh, repo, { ...input, file }, log);
            const duplicate = UIIssues.has(data.id);

            log.info(
              {
                id: data.id,
                severity: data.severity,
                file: data.file,
                duplicate,
              },
              "issue emitted"
            );

            if (duplicate) {
              return { ok: true, duplicate: true };
            }

            UIIssues.set(data.id, data);
            writer.write({ type: "data-issue", data, transient: true });
            return { ok: true };
          }
        ),
    }),
  } satisfies Record<ReviewToolName, unknown>;
}
