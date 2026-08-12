import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGithubAccess, GitHubApiError, NotFoundError } from "./index";
import type { DirectoryEntry } from "./list-directory";
import type { FileContents } from "./get-file-contents";
import type { PRMetadata } from "./get-pr-metadata";

const { listDirectoryMock, getFileContentsMock, getPRMetadataMock } =
  vi.hoisted(() => ({
    listDirectoryMock: vi.fn(),
    getFileContentsMock: vi.fn(),
    getPRMetadataMock: vi.fn(),
  }));

vi.mock("./list-directory", () => ({ listDirectory: listDirectoryMock }));
vi.mock("./get-file-contents", () => ({
  getFileContents: getFileContentsMock,
}));
vi.mock("./get-pr-metadata", () => ({ getPRMetadata: getPRMetadataMock }));

const PR = { owner: "vercel", repo: "ms", prNumber: 17 };
const REF = "7c2d4f1b0e9a3c85d6f2b1a4e8c0d9f3a6b5c4e2";

const METADATA: PRMetadata = {
  title: "parse: support week units",
  body: "",
  isPrivate: false,
  baseRef: "master",
  headRef: "add-week-unit",
  headSha: REF,
  changedFiles: 3,
};

const CONTENTS: FileContents = {
  path: "index.js",
  ref: REF,
  content: "var w = d * 7;",
  size: 14,
  sha: "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d",
};

const serverError = () => new GitHubApiError(500, "Internal Server Error");

const read = (gh: ReturnType<typeof createGithubAccess>) =>
  gh.getFileContents({ path: "index.js", ref: REF, maxBytes: 18_000 });

const entries = (path: string): DirectoryEntry[] => [
  {
    path: `${path}/index.ts`,
    name: "index.ts",
    type: "file",
    size: 120,
    sha: "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d",
  },
];

describe("createGithubAccess caches directory listings", () => {
  beforeEach(() => {
    listDirectoryMock.mockReset();
  });

  it("calls GitHub once per ref and path", async () => {
    listDirectoryMock.mockImplementation(async ({ path }: { path: string }) =>
      entries(path),
    );

    const gh = createGithubAccess(null, PR);
    const first = await gh.listDirectory({ path: "src", ref: REF });
    const again = await gh.listDirectory({ path: "src", ref: REF });

    expect(again).toBe(first);
    expect(listDirectoryMock).toHaveBeenCalledTimes(1);

    await gh.listDirectory({ path: "test", ref: REF });
    expect(listDirectoryMock).toHaveBeenCalledTimes(2);
  });

  it("keeps no entry for a listing that failed", async () => {
    listDirectoryMock
      .mockRejectedValueOnce(new NotFoundError("directory vercel/ms@ref:src"))
      .mockResolvedValueOnce(entries("src"));

    const gh = createGithubAccess(null, PR);

    await expect(
      gh.listDirectory({ path: "src", ref: REF }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(gh.listDirectory({ path: "src", ref: REF })).resolves.toEqual(
      entries("src"),
    );

    expect(listDirectoryMock).toHaveBeenCalledTimes(2);
  });
});

describe("createGithubAccess retries what GitHub may answer again", () => {
  beforeEach(() => {
    getPRMetadataMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks a second time after a 500 and returns the second answer", async () => {
    getPRMetadataMock
      .mockRejectedValueOnce(serverError())
      .mockResolvedValueOnce(METADATA);

    const pending = createGithubAccess(null, PR).getPRMetadata();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toEqual(METADATA);
    expect(getPRMetadataMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the third attempt instead of hammering GitHub", async () => {
    getPRMetadataMock.mockRejectedValue(serverError());

    const pending = createGithubAccess(null, PR).getPRMetadata();
    const settled = expect(pending).rejects.toBeInstanceOf(GitHubApiError);
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;

    expect(getPRMetadataMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry an answer GitHub will repeat", async () => {
    getPRMetadataMock.mockRejectedValue(new NotFoundError("PR vercel/ms#17"));

    const pending = createGithubAccess(null, PR).getPRMetadata();
    const settled = expect(pending).rejects.toBeInstanceOf(NotFoundError);
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;

    expect(getPRMetadataMock).toHaveBeenCalledTimes(1);
  });

  it("stops retrying the moment the caller walks away", async () => {
    getPRMetadataMock.mockRejectedValue(serverError());
    const controller = new AbortController();

    const pending = createGithubAccess(
      null,
      PR,
      controller.signal,
    ).getPRMetadata();
    const settled = expect(pending).rejects.toBeInstanceOf(GitHubApiError);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;

    expect(getPRMetadataMock).toHaveBeenCalledTimes(1);
  });

  it("asks once for a metadata request the caller repeats", async () => {
    getPRMetadataMock.mockResolvedValue(METADATA);

    const gh = createGithubAccess(null, PR);
    const first = gh.getPRMetadata();

    await expect(gh.getPRMetadata()).resolves.toBe(await first);
    expect(getPRMetadataMock).toHaveBeenCalledTimes(1);
  });
});

describe("createGithubAccess caches file contents", () => {
  beforeEach(() => {
    getFileContentsMock.mockReset();
  });

  it("calls GitHub once per ref and path", async () => {
    getFileContentsMock.mockResolvedValue(CONTENTS);

    const gh = createGithubAccess(null, PR);
    const first = await read(gh);

    expect(await read(gh)).toBe(first);
    expect(getFileContentsMock).toHaveBeenCalledTimes(1);
  });

  it("forgets a read that failed so the model can ask for the file again", async () => {
    getFileContentsMock
      .mockRejectedValueOnce(new NotFoundError("file index.js"))
      .mockResolvedValue(CONTENTS);

    const gh = createGithubAccess(null, PR);

    await expect(read(gh)).rejects.toBeInstanceOf(NotFoundError);
    await expect(read(gh)).resolves.toEqual(CONTENTS);

    expect(getFileContentsMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the read that succeeded after the one that failed", async () => {
    getFileContentsMock
      .mockRejectedValueOnce(new NotFoundError("file index.js"))
      .mockResolvedValue(CONTENTS);

    const gh = createGithubAccess(null, PR);

    await expect(read(gh)).rejects.toBeInstanceOf(NotFoundError);
    const recovered = await read(gh);

    expect(await read(gh)).toBe(recovered);
    expect(getFileContentsMock).toHaveBeenCalledTimes(2);
  });

  it("keeps one failure from poisoning the key for the rest of the review", async () => {
    getFileContentsMock.mockRejectedValue(new NotFoundError("file index.js"));

    const gh = createGithubAccess(null, PR);

    await expect(read(gh)).rejects.toBeInstanceOf(NotFoundError);
    await expect(read(gh)).rejects.toBeInstanceOf(NotFoundError);
    await expect(read(gh)).rejects.toBeInstanceOf(NotFoundError);

    expect(getFileContentsMock).toHaveBeenCalledTimes(3);
  });
});
