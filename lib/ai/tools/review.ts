import {
  GithubAccess,
  GitHubApiError,
  NotFoundError,
} from "@/lib/github/octokit";
import { tool, UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { truncateBody } from "./utils";
import {
  modelIssueSchema,
  ModelIssue,
  ReviewUIMessage,
} from "../schema/modelIssue";
import type { ReviewToolName } from "./names";

export function makeReviewTools(
  gh: GithubAccess,
  ref: string,
  modelIssues: ModelIssue[],
  writer: UIMessageStreamWriter<ReviewUIMessage>
) {
  return {
    get_pr_metadata: tool({
      description: `Start here to understand the PR's intent and scope before reading diffs. Fields it returns: 
title: what the author claims the PR does – check the code against it;
body: author's description of the PR. If body_truncated is true – you see only the start of the body – don't assume it's the full description;
changed_files: number of files touched – use it to gauge review scope;
head_ref – source branch;
base_ref – target branch.`,
      inputSchema: z.object({}),
      execute: async () => {
        console.log("[tool]", "get_pr_metadata", {});

        const { title, body, changed_files, head_ref, base_ref } =
          await gh.getPRMetadata();
        const truncatedBody = truncateBody(body);

        return {
          title,
          body: truncatedBody.body,
          body_truncated: truncatedBody.bodyTruncated,
          changed_files,
          head_ref,
          base_ref,
        };
      },
    }),
    get_pr_files_summary: tool({
      description: `Returns the list of changed files with per–file statistics, but not the actual diff – use get_diff(filename) to read the patch. Use it to decide which diffs to read. Fields it returns:
filename: the file's path. It's the identifier you pass to the get_diff and get_file_contents tools;
status: shows whether the file was added, removed, modified or renamed;
additions: number of added lines;
deletions: number of removed lines;
changes: total lines changed (additions + deletions);
previous_filename: old file name, if it was renamed.`,
      inputSchema: z.object({}),
      execute: async () => {
        console.log("[tool]", "get_pr_files_summary", {});

        const files = await gh.getPRFiles();

        return {
          files,
        };
      },
    }),
    get_diff: tool({
      description: `Return the patch (unified diff) for one changed file. Pass the exact filename from get_pr_files_summary. Returns { patch } in the success case. Returns {status, reason} if there is a problem:
not_in_pr – re–check get_pr_files_summary for this path;
no_patch – skip the file.`,
      inputSchema: z.object({
        filename: z.string(),
      }),
      execute: async ({ filename }) => {
        console.log("[tool]", "get_diff", { filename });
        const diff = await gh.getDiff(filename);

        if (!diff) {
          const file = await gh.getFile(filename);

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

        return {
          patch: diff,
        };
      },
    }),
    get_file_contents: tool({
      description: `Returns the full content of a single file at the PR's head state. Use it when the diff alone isn't enough to judge a change – e.g., to see how a changed function is defined or used elsewhere in the file. Returns { content, size } in the success case. Returns {status, reason} if there is a problem:
not_found – the file doesn't exist at the PR head (e.g., deleted in this PR) or the path may be wrong – check get_pr_files_summary for valid paths;
too_large – read file via get_diff, whole file can't be fetched;
unavailable – couldn't read the file; see reason (e.g., too large, or the path is a directory).`,
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path }) => {
        console.log("[tool]", "get_file_contents", { path });

        try {
          const { content, size } = await gh.getFileContents({ path, ref });

          if (size > 9_000) {
            return { status: "too_large" };
          }

          return { content, size };
        } catch (e) {
          if (e instanceof NotFoundError) return { status: "not_found" };
          if (e instanceof GitHubApiError)
            return { status: "unavailable", reason: e.message };
          throw e;
        }
      },
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
      execute: async ({ path }) => {
        console.log("[tool]", "list_directory", { path });

        try {
          const entries = await gh.listDirectory({ path, ref });

          return {
            entries: entries.map(({ path, type }) => ({
              path,
              type,
            })),
          };
        } catch (e) {
          if (e instanceof NotFoundError) return { status: "not_found" };
          if (e instanceof GitHubApiError)
            return { status: "unavailable", reason: e.message };
          throw e;
        }
      },
    }),
    emit_issue: tool({
      description:
        "Report a single code-review issue you found in this PR. Call it once per issue, the moment you have confirmed a problem — do not batch issues for the end, and never write issues as plain text. You provide the location (file + line range) and the explanation; the code snippet is added by the backend, so do not send code",
      inputSchema: modelIssueSchema,
      execute: (input) => {
        modelIssues.push(input);

        writer.write({ type: "data-issue", data: input, transient: true });
        return { ok: true };
      },
    }),
    // скрепка с lib/ai/tools/names.ts: переименование ключа тула только здесь
    // (или только там) не скомпилируется
  } satisfies Record<ReviewToolName, unknown>;
}
