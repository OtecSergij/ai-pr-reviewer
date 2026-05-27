import type { Octokit } from "@octokit/rest";
import { GitHubApiError, translateOctokitError } from "./errors";

export type DirectoryEntryType = "file" | "dir" | "symlink" | "submodule";

export type DirectoryEntry = {
  path: string;
  name: string;
  type: DirectoryEntryType;
  size: number;
  sha: string;
};

export async function listDirectory(
  client: Octokit,
  params: { owner: string; repo: string; path: string; ref: string },
): Promise<DirectoryEntry[]> {
  const { owner, repo, path, ref } = params;
  try {
    const { data } = await client.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    if (!Array.isArray(data)) {
      throw new GitHubApiError(
        200,
        `Expected directory at ${path}, got ${data.type}`,
      );
    }

    return data.map((e) => ({
      path: e.path,
      name: e.name,
      type: e.type as DirectoryEntryType,
      size: e.size,
      sha: e.sha,
    }));
  } catch (err) {
    translateOctokitError(
      err,
      `directory ${owner}/${repo}@${ref}:${path || "/"}`,
    );
  }
}
