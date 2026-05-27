import type { Octokit } from "@octokit/rest";
import type { PRRef } from "../parse-url";
import { translateOctokitError } from "./errors";

export type PRMetadata = {
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged: boolean;
  base_ref: string;
  head_ref: string;
  head_sha: string;
  changed_files: number;
  html_url: string;
};

export async function getPRMetadata(
  client: Octokit,
  ref: PRRef,
): Promise<PRMetadata> {
  const { owner, repo, pr_number } = ref;
  try {
    const { data } = await client.rest.pulls.get({
      owner,
      repo,
      pull_number: pr_number,
    });
    return {
      title: data.title,
      body: data.body,
      state: data.state,
      merged: data.merged ?? false,
      base_ref: data.base.ref,
      head_ref: data.head.ref,
      head_sha: data.head.sha,
      changed_files: data.changed_files,
      html_url: data.html_url,
    };
  } catch (err) {
    translateOctokitError(err, `PR ${owner}/${repo}#${pr_number}`);
  }
}
