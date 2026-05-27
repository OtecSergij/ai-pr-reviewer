import type { Octokit } from "@octokit/rest";
import type { PRRef } from "../parse-url";
import { translateOctokitError } from "./errors";

export type PRFileStatus =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";

export type PRFile = {
  filename: string;
  status: PRFileStatus;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  previous_filename: string | null;
};

export async function getPRFiles(
  client: Octokit,
  ref: PRRef,
): Promise<PRFile[]> {
  const { owner, repo, pr_number } = ref;
  try {
    const files = await client.paginate(client.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pr_number,
      per_page: 100,
    });
    return files.map((f) => ({
      filename: f.filename,
      status: f.status as PRFileStatus,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch ?? null,
      previous_filename: f.previous_filename ?? null,
    }));
  } catch (err) {
    translateOctokitError(err, `PR files ${owner}/${repo}#${pr_number}`);
  }
}
