import type { Octokit } from "@octokit/rest";
import { GitHubApiError, translateOctokitError } from "./errors";

export type FileContents = {
  path: string;
  ref: string;
  content: string | null;
  size: number;
  sha: string;
};

export async function getFileContents(
  client: Octokit,
  params: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
    maxBytes: number;
  },
): Promise<FileContents> {
  const { owner, repo, path, ref, maxBytes } = params;
  try {
    const { data } = await client.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    if (Array.isArray(data)) {
      throw new GitHubApiError(
        200,
        `Expected file at ${path}, got directory`,
      );
    }

    if (data.type !== "file") {
      throw new GitHubApiError(
        200,
        `Expected file at ${path}, got ${data.type}`,
      );
    }

    if (data.size > maxBytes || data.encoding !== "base64") {
      return {
        path: data.path,
        ref,
        content: null,
        size: data.size,
        sha: data.sha,
      };
    }

    const decoded = Buffer.from(data.content, "base64").toString("utf-8");

    return {
      path: data.path,
      ref,
      content: decoded,
      size: data.size,
      sha: data.sha,
    };
  } catch (err) {
    translateOctokitError(err, `file ${owner}/${repo}@${ref}:${path}`);
  }
}
