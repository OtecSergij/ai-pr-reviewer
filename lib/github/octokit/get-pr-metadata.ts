import type { Octokit } from "@octokit/rest";
import type { PRRef } from "../parse-url";
import { translateOctokitError } from "./errors";

export type PRMetadata = {
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged: boolean;
  isPrivate: boolean;
  baseRef: string;
  headRef: string;
  headSha: string;
  changedFiles: number;
  htmlUrl: string;
};

export async function getPRMetadata(
  client: Octokit,
  ref: PRRef,
): Promise<PRMetadata> {
  const { owner, repo, prNumber } = ref;
  try {
    const { data } = await client.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    return {
      title: data.title,
      body: data.body,
      state: data.state,
      merged: data.merged ?? false,
      isPrivate: data.base.repo.private,
      baseRef: data.base.ref,
      headRef: data.head.ref,
      headSha: data.head.sha,
      changedFiles: data.changed_files,
      htmlUrl: data.html_url,
    };
  } catch (err) {
    translateOctokitError(err, `PR ${owner}/${repo}#${prNumber}`);
  }
}
