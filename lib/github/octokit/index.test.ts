import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGithubAccess, NotFoundError } from "./index";
import type { DirectoryEntry } from "./list-directory";

const { listDirectoryMock } = vi.hoisted(() => ({
  listDirectoryMock: vi.fn(),
}));

vi.mock("./list-directory", () => ({ listDirectory: listDirectoryMock }));

const PR = { owner: "vercel", repo: "ms", prNumber: 17 };
const REF = "7c2d4f1b0e9a3c85d6f2b1a4e8c0d9f3a6b5c4e2";

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
      entries(path)
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
      gh.listDirectory({ path: "src", ref: REF })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      gh.listDirectory({ path: "src", ref: REF })
    ).resolves.toEqual(entries("src"));

    expect(listDirectoryMock).toHaveBeenCalledTimes(2);
  });
});
