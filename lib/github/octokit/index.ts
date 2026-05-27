import { Octokit } from "@octokit/rest";
import type { PRRef } from "../parse-url";
import { getPRMetadata, type PRMetadata } from "./get-pr-metadata";
import { getPRFiles, type PRFile, type PRFileStatus } from "./get-pr-files";
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
  getPRFiles: () => Promise<PRFile[]>;
  getFile: (filename: string) => Promise<PRFile | null>;
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

  const ensureMetadata = (): Promise<PRMetadata> => {
    if (!metadataPromise) {
      metadataPromise = getPRMetadata(client, pr);
    }
    return metadataPromise;
  };

  const ensureFiles = (): Promise<Map<string, PRFile>> => {
    if (!filesPromise) {
      filesPromise = getPRFiles(client, pr).then(
        (arr) => new Map(arr.map((f) => [f.filename, f])),
      );
    }
    return filesPromise;
  };

  return {
    getPRMetadata: () => ensureMetadata(),
    getPRFiles: async () => [...(await ensureFiles()).values()],
    getFile: async (filename) =>
      (await ensureFiles()).get(filename) ?? null,
    getDiff: async (filename) =>
      (await ensureFiles()).get(filename)?.patch ?? null,
    getFileContents: ({ path, ref }) =>
      getFileContents(client, {
        owner: pr.owner,
        repo: pr.repo,
        path,
        ref,
      }),
    listDirectory: ({ path, ref }) =>
      listDirectory(client, {
        owner: pr.owner,
        repo: pr.repo,
        path,
        ref,
      }),
  };
}
