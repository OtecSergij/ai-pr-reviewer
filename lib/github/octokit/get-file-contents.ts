import type { Octokit } from "@octokit/rest";
import { GitHubApiError, translateOctokitError } from "./errors";

export type FileContents = {
  path: string;
  ref: string;
  content: string;
  size: number;
  sha: string;
};

export async function getFileContents(
  client: Octokit,
  params: { owner: string; repo: string; path: string; ref: string },
): Promise<FileContents> {
  const { owner, repo, path, ref } = params;
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

    if (data.encoding !== "base64") {
      throw new GitHubApiError(
        200,
        `Cannot read file at ${path}: encoding=${data.encoding}, size=${data.size}. ` +
          `Files >1MB require Git Blob API.`,
      );
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
