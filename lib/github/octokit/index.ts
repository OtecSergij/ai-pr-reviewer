import { Octokit } from "@octokit/rest";
import type { PRRef } from "../parse-url";
import { getPRMetadata, type PRMetadata } from "./get-pr-metadata";
import {
  getPRFiles,
  toPRFileSummary,
  type PRFile,
  type PRFileStatus,
  type PRFileSummary,
} from "./get-pr-files";
import { getFileContents, type FileContents } from "./get-file-contents";
import {
  listDirectory,
  type DirectoryEntry,
  type DirectoryEntryType,
} from "./list-directory";

export type {
  PRMetadata,
  PRFile,
  PRFileStatus,
  PRFileSummary,
  FileContents,
  DirectoryEntry,
  DirectoryEntryType,
};
export {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  SecondaryRateLimitError,
  GitHubApiError,
} from "./errors";

export type GithubAccess = {
  getPRMetadata: () => Promise<PRMetadata>;
  getPRFiles: () => Promise<PRFileSummary[]>;
  getFile: (filename: string) => Promise<PRFileSummary | null>;
  getDiff: (filename: string) => Promise<string | null>;
  getFileContents: (params: {
    path: string;
    ref: string;
  }) => Promise<FileContents>;
  listDirectory: (params: {
    path: string;
    ref: string;
  }) => Promise<DirectoryEntry[]>;
};

export function createGithubAccess(token: string, pr: PRRef): GithubAccess {
  if (!token) {
    throw new Error("GitHub token is required to create access object");
  }
  const client = new Octokit({ auth: token });

  let metadataPromise: Promise<PRMetadata> | null = null;
  let filesPromise: Promise<Map<string, PRFile>> | null = null;
  const fileContentsCache = new Map<string, Promise<FileContents>>();

  const ensureMetadata = (): Promise<PRMetadata> => {
    if (!metadataPromise) {
      metadataPromise = getPRMetadata(client, pr);
    }
    return metadataPromise;
  };

  const ensureFiles = (): Promise<Map<string, PRFile>> => {
    if (!filesPromise) {
      filesPromise = getPRFiles(client, pr).then(
        (arr) => new Map(arr.map((f) => [f.filename, f]))
      );
    }
    return filesPromise;
  };

  return {
    getPRMetadata: () => ensureMetadata(),
    getPRFiles: async () =>
      [...(await ensureFiles()).values()].map(toPRFileSummary),
    getFile: async (filename) => {
      const file = (await ensureFiles()).get(filename);
      return file ? toPRFileSummary(file) : null;
    },
    getDiff: async (filename) =>
      (await ensureFiles()).get(filename)?.patch ?? null,
    getFileContents: ({ path, ref }) => {
      const key = `${ref}:${path}`;
      let cached = fileContentsCache.get(key);
      if (!cached) {
        cached = getFileContents(client, {
          owner: pr.owner,
          repo: pr.repo,
          path,
          ref,
        });
        fileContentsCache.set(key, cached);
      }
      return cached;
    },
    listDirectory: ({ path, ref }) =>
      listDirectory(client, {
        owner: pr.owner,
        repo: pr.repo,
        path,
        ref,
      }),
  };
}
