import { describe, expect, it, vi } from "vitest";
import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import { getFileContents } from "./get-file-contents";
import { GitHubApiError, NotFoundError } from "./errors";

type GetContentResponse = Awaited<
  ReturnType<Octokit["rest"]["repos"]["getContent"]>
>;
type ContentData = GetContentResponse["data"];
type ContentFile = Extract<ContentData, { type: "file" }>;
type ContentSymlink = Extract<ContentData, { type: "symlink" }>;
type DirectoryEntries = Extract<ContentData, unknown[]>;

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

const file = (overrides: Partial<ContentFile> = {}): ContentFile => ({
  type: "file",
  encoding: "base64",
  size: 0,
  name: "empty.txt",
  path: "empty.txt",
  content: "",
  sha: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
  url: contentsUrl("empty.txt"),
  git_url: null,
  html_url: null,
  download_url: null,
  _links: links("empty.txt"),
  ...overrides,
});

const symlink = (path: string): ContentSymlink => ({
  type: "symlink",
  target: "../shared/config.js",
  size: 20,
  name: "config.js",
  path,
  sha: "9a1f2b3c4d5e6f708192a3b4c5d6e7f809a1b2c3",
  url: contentsUrl(path),
  git_url: null,
  html_url: null,
  download_url: null,
  _links: links(path),
});

const directory = (path: string): DirectoryEntries => [
  {
    type: "file",
    size: 1024,
    name: "test.js",
    path: `${path}/test.js`,
    sha: "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d",
    url: contentsUrl(`${path}/test.js`),
    git_url: null,
    html_url: null,
    download_url: null,
    _links: links(`${path}/test.js`),
  },
];

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

const MAX_BYTES = 18_000;

const read = (client: Octokit, path: string, maxBytes = MAX_BYTES) =>
  getFileContents(client, {
    owner: OWNER,
    repo: REPO,
    path,
    ref: REF,
    maxBytes,
  });

describe("getFileContents on a readable blob", () => {
  it("reads a zero-byte file as empty content", async () => {
    const client = clientReturning(
      file({ path: ".gitkeep", name: ".gitkeep", content: "", size: 0 })
    );

    await expect(read(client, ".gitkeep")).resolves.toEqual({
      path: ".gitkeep",
      ref: REF,
      content: "",
      size: 0,
      sha: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
    });
  });

  it("decodes base64 that the API wrapped across lines", async () => {
    const source = "var w = d * 7;\nvar y = d * 365.25;\n";
    const encoded = Buffer.from(source, "utf-8").toString("base64");
    const client = clientReturning(
      file({
        path: "index.js",
        name: "index.js",
        content: `${encoded.slice(0, 20)}\n${encoded.slice(20)}\n`,
        size: Buffer.byteLength(source, "utf-8"),
      })
    );

    const contents = await read(client, "index.js");

    expect(contents.content).toBe(source);
  });
});

describe("getFileContents on something that is not a readable blob", () => {
  it("rejects a directory asked for as a file", async () => {
    const client = clientReturning(directory("test"));

    await expect(read(client, "test")).rejects.toBeInstanceOf(GitHubApiError);
    await expect(read(client, "test")).rejects.toThrow(
      "Expected file at test, got directory"
    );
  });

  it("rejects a symlink asked for as a file", async () => {
    const client = clientReturning(symlink("config.js"));

    await expect(read(client, "config.js")).rejects.toBeInstanceOf(
      GitHubApiError
    );
    await expect(read(client, "config.js")).rejects.toThrow(
      "Expected file at config.js, got symlink"
    );
  });

  it("refuses a blob the API would not encode as oversized rather than throwing", async () => {
    const client = clientReturning(
      file({
        path: "dist/bundle.js",
        name: "bundle.js",
        encoding: "none",
        content: "",
        size: 2_400_000,
      })
    );

    await expect(read(client, "dist/bundle.js")).resolves.toEqual({
      path: "dist/bundle.js",
      ref: REF,
      content: null,
      size: 2_400_000,
      sha: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
    });
  });
});

describe("getFileContents against the caller's size cap", () => {
  it("refuses a file over the cap without decoding it", async () => {
    const source = "x".repeat(40_000);
    const client = clientReturning(
      file({
        path: "src/big.ts",
        name: "big.ts",
        content: Buffer.from(source, "utf-8").toString("base64"),
        size: Buffer.byteLength(source, "utf-8"),
      })
    );

    const contents = await read(client, "src/big.ts");

    expect(contents.content).toBeNull();
    expect(contents.size).toBe(40_000);
  });

  it("serves a file that is exactly at the cap", async () => {
    const source = "y".repeat(MAX_BYTES);
    const client = clientReturning(
      file({
        path: "src/edge.ts",
        name: "edge.ts",
        content: Buffer.from(source, "utf-8").toString("base64"),
        size: MAX_BYTES,
      })
    );

    const contents = await read(client, "src/edge.ts");

    expect(contents.content).toBe(source);
  });
});

describe("getFileContents error translation", () => {
  it("turns a 404 into NotFoundError naming the missing blob", async () => {
    const client = clientFailing(notFound("src/parse.ts"));

    await expect(read(client, "src/parse.ts")).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(read(client, "src/parse.ts")).rejects.toThrow(
      `file ${OWNER}/${REPO}@${REF}:src/parse.ts was not found`
    );
  });
});
