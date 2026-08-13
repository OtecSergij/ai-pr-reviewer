import { describe, expect, it, vi } from "vitest";
import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import { listDirectory } from "./list-directory";
import { GitHubApiError, NotFoundError } from "./errors";

type GetContentResponse = Awaited<
  ReturnType<Octokit["rest"]["repos"]["getContent"]>
>;
type ContentData = GetContentResponse["data"];
type ContentFile = Extract<ContentData, { type: "file" }>;
type DirectoryEntries = Extract<ContentData, unknown[]>;
type DirectoryItem = DirectoryEntries[number];

const OWNER = "vercel";
const REPO = "ms";
const REF = "7c2d4f1b0e9a3c85d6f2b1a4e8c0d9f3a6b5c4e2";

const contentsUrl = (path: string): string =>
  `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;

const links = (path: string) => ({
  git: null,
  html: null,
  self: contentsUrl(path),
});

const entry = (fields: {
  type: DirectoryItem["type"];
  path: string;
  name: string;
  size: number;
}): DirectoryItem => ({
  type: fields.type,
  size: fields.size,
  name: fields.name,
  path: fields.path,
  sha: `${fields.type}-sha`,
  url: contentsUrl(fields.path),
  git_url: null,
  html_url: null,
  download_url: null,
  _links: links(fields.path),
});

const file = (path: string, name: string): ContentFile => ({
  type: "file",
  encoding: "base64",
  size: 42,
  name,
  path,
  content: "",
  sha: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
  url: contentsUrl(path),
  git_url: null,
  html_url: null,
  download_url: null,
  _links: links(path),
});

const clientReturning = (data: ContentData): Octokit => {
  const client = new Octokit();
  vi.spyOn(client.rest.repos, "getContent").mockResolvedValue({
    status: 200,
    url: contentsUrl(""),
    headers: {},
    data,
  });
  return client;
};

const clientFailing = (error: Error): Octokit => {
  const client = new Octokit();
  vi.spyOn(client.rest.repos, "getContent").mockRejectedValue(error);
  return client;
};

const notFound = (path: string): RequestError =>
  new RequestError("Not Found", 404, {
    request: { method: "GET", url: contentsUrl(path), headers: {} },
    response: {
      status: 404,
      url: contentsUrl(path),
      headers: {},
      data: { message: "Not Found" },
    },
  });

const list = (client: Octokit, path: string) =>
  listDirectory(client, { owner: OWNER, repo: REPO, path, ref: REF });

describe("listDirectory on a directory", () => {
  it("maps every entry kind GitHub can return", async () => {
    const client = clientReturning([
      entry({ type: "dir", path: "src/tools", name: "tools", size: 0 }),
      entry({
        type: "file",
        path: "src/index.ts",
        name: "index.ts",
        size: 1024,
      }),
      entry({
        type: "symlink",
        path: "src/latest.ts",
        name: "latest.ts",
        size: 12,
      }),
      entry({ type: "submodule", path: "src/vendor", name: "vendor", size: 0 }),
    ]);

    await expect(list(client, "src")).resolves.toEqual([
      {
        path: "src/tools",
        name: "tools",
        type: "dir",
        size: 0,
        sha: "dir-sha",
      },
      {
        path: "src/index.ts",
        name: "index.ts",
        type: "file",
        size: 1024,
        sha: "file-sha",
      },
      {
        path: "src/latest.ts",
        name: "latest.ts",
        type: "symlink",
        size: 12,
        sha: "symlink-sha",
      },
      {
        path: "src/vendor",
        name: "vendor",
        type: "submodule",
        size: 0,
        sha: "submodule-sha",
      },
    ]);
  });

  it("returns an empty listing as an empty array", async () => {
    const client = clientReturning([]);

    await expect(list(client, "docs")).resolves.toEqual([]);
  });
});

describe("listDirectory on something that is not a directory", () => {
  it("rejects a file asked for as a directory", async () => {
    const client = clientReturning(file("index.js", "index.js"));

    await expect(list(client, "index.js")).rejects.toBeInstanceOf(
      GitHubApiError,
    );
    await expect(list(client, "index.js")).rejects.toThrow(
      "Expected directory at index.js, got file",
    );
  });
});

describe("listDirectory error translation", () => {
  it("turns a 404 into NotFoundError naming the missing directory", async () => {
    const client = clientFailing(notFound("lib"));

    await expect(list(client, "lib")).rejects.toBeInstanceOf(NotFoundError);
    await expect(list(client, "lib")).rejects.toThrow(
      `directory ${OWNER}/${REPO}@${REF}:lib was not found`,
    );
  });

  it("names the repository root when the listed path is empty", async () => {
    const client = clientFailing(notFound(""));

    await expect(list(client, "")).rejects.toThrow(
      `directory ${OWNER}/${REPO}@${REF}:/ was not found`,
    );
  });
});
