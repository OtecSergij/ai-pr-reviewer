import "server-only";
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
import { listDirectory, type DirectoryEntry } from "./list-directory";
import { GitHubApiError } from "./errors";
import { timeboxedFetch } from "./timeboxed-fetch";

export type {
  PRMetadata,
  PRFileStatus,
  PRFileSummary,
  FileContents,
  DirectoryEntry,
};
export {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  SecondaryRateLimitError,
  GitHubTimeoutError,
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

const RETRY_OPTS = {
  baseMs: 500,
  retries: 2,
  isRetryable: (e: unknown) => {
    if (e instanceof GitHubApiError && e.status >= 500) {
      return true;
    }
    return false;
  },
};

export function createGithubAccess(
  token: string | null,
  pr: PRRef,
  signal?: AbortSignal
): GithubAccess {
  const request = { fetch: timeboxedFetch(), signal };
  const client = token
    ? new Octokit({ auth: token, request })
    : new Octokit({ request });
  const retryOpts = { ...RETRY_OPTS, signal };

  let metadataPromise: Promise<PRMetadata> | null = null;
  let filesPromise: Promise<Map<string, PRFile>> | null = null;
  const fileContentsCache = new Map<string, Promise<FileContents>>();

  const ensureMetadata = (): Promise<PRMetadata> => {
    if (!metadataPromise) {
      metadataPromise = withRetry(() => getPRMetadata(client, pr), retryOpts);
    }
    return metadataPromise;
  };

  const ensureFiles = (): Promise<Map<string, PRFile>> => {
    if (!filesPromise) {
      filesPromise = withRetry(() => getPRFiles(client, pr), retryOpts).then(
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
        cached = withRetry(
          () =>
            getFileContents(client, {
              owner: pr.owner,
              repo: pr.repo,
              path,
              ref,
            }),
          retryOpts
        );
        cached.catch(() => {
          if (fileContentsCache.get(key) === cached) {
            fileContentsCache.delete(key);
          }
        });
        fileContentsCache.set(key, cached);
      }
      return cached;
    },
    listDirectory: ({ path, ref }) =>
      withRetry(
        () =>
          listDirectory(client, {
            owner: pr.owner,
            repo: pr.repo,
            path,
            ref,
          }),
        retryOpts
      ),
  };
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries: number;
    baseMs: number;
    isRetryable: (e: unknown) => boolean;
    signal?: AbortSignal;
  }
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();

    try {
      return await fn();
    } catch (e) {
      if (
        options.signal?.aborted ||
        !options.isRetryable(e) ||
        attempt >= options.retries
      ) {
        throw e;
      }

      const expo = options.baseMs * 2 ** attempt;

      await sleep(Math.random() * expo, options.signal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);

    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }

    signal?.addEventListener("abort", done, { once: true });
  });
}
