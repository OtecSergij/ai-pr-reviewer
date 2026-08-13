import { describe, expect, it } from "vitest";
import pino from "pino";
import { parseUnifiedDiff } from "@/lib/github/diff";
import {
  GitHubApiError,
  NotFoundError,
  type DirectoryEntry,
} from "@/lib/github/octokit";
import { basename } from "@/lib/path";
import { enrichIssue } from "@/lib/review/enrich-issue";
import { MAX_FILE_CONTENTS_BYTES } from "@/lib/review/config";
import { createFixtureGithubAccess } from "./github-fixture";
import { mockModelIssues, richModelIssues } from "./issues";

const pr = { owner: "someone", repo: "anything", prNumber: 1 };
const gh = createFixtureGithubAccess(pr);
const log = pino({ level: "silent" });

const headSha = async (): Promise<string> => (await gh.getPRMetadata()).headSha;

const patchOf = async (filename: string): Promise<string> => {
  const patch = await gh.getDiff(filename);
  if (patch === null) expect.unreachable(`${filename} has no patch`);
  return patch;
};

const contentsOf = async (path: string) =>
  gh.getFileContents({
    path,
    ref: await headSha(),
    maxBytes: MAX_FILE_CONTENTS_BYTES,
  });

const contentLines = async (path: string): Promise<string[]> => {
  const { content } = await contentsOf(path);
  if (content === null) expect.unreachable(`${path} was refused as too large`);
  return content.split("\n");
};

const filesUnder = async (path: string): Promise<DirectoryEntry[]> => {
  const entries = await gh.listDirectory({ path, ref: await headSha() });
  return entries.filter((entry) => entry.type === "file");
};

describe("fixture patches line up with file contents", () => {
  it("matches every hunk line against the file at its newLineno", async () => {
    for (const file of await gh.getPRFiles()) {
      const lines = await contentLines(file.filename);

      for (const hunk of parseUnifiedDiff(await patchOf(file.filename))) {
        let lastNewLineno = -1;

        for (const line of hunk.lines) {
          if (line.newLineno === null) continue;
          lastNewLineno = line.newLineno;
          expect(
            lines[line.newLineno - 1],
            `${file.filename}:${line.newLineno} (${line.kind})`,
          ).toBe(line.content);
        }

        expect(
          lastNewLineno,
          `${file.filename} hunk ending at ${hunk.newEnd}`,
        ).toBe(hunk.newEnd);
      }
    }
  });

  it("counts the additions and deletions the summary reports", async () => {
    for (const file of await gh.getPRFiles()) {
      let additions = 0;
      let deletions = 0;

      for (const hunk of parseUnifiedDiff(await patchOf(file.filename))) {
        for (const line of hunk.lines) {
          if (line.kind === "added") additions += 1;
          if (line.kind === "removed") deletions += 1;
        }
      }

      expect({ additions, deletions }, file.filename).toEqual({
        additions: file.additions,
        deletions: file.deletions,
      });
    }
  });
});

describe("fixture summary is self-consistent", () => {
  it("reports changes as additions plus deletions", async () => {
    for (const file of await gh.getPRFiles()) {
      expect(file.changes, file.filename).toBe(file.additions + file.deletions);
    }
  });

  it("reports as many changed files as it lists", async () => {
    const { changedFiles } = await gh.getPRMetadata();
    expect(changedFiles).toBe((await gh.getPRFiles()).length);
  });
});

describe("fixture files stay readable through the file-contents tool", () => {
  it("keeps every discoverable file under the tool's size limit", async () => {
    const files = [...(await filesUnder("")), ...(await filesUnder("test"))];
    expect(files.length).toBeGreaterThan(0);

    for (const entry of files) {
      const { size, content } = await contentsOf(entry.path);
      expect(size, entry.path).toBeLessThanOrEqual(MAX_FILE_CONTENTS_BYTES);
      expect(content, entry.path).not.toBeNull();
    }
  });
});

describe("fixture directory listing", () => {
  it("lists the repository root as four files and one directory", async () => {
    const entries = await gh.listDirectory({ path: "", ref: await headSha() });

    expect(
      entries.map((entry) => ({ path: entry.path, type: entry.type })),
    ).toEqual([
      { path: "README.md", type: "file" },
      { path: "index.js", type: "file" },
      { path: "license.md", type: "file" },
      { path: "package.json", type: "file" },
      { path: "test", type: "dir" },
    ]);
  });

  it("names every root entry after its path and sizes the files", async () => {
    const entries = await gh.listDirectory({ path: "", ref: await headSha() });

    for (const entry of entries) {
      expect(entry.name, entry.path).toBe(basename(entry.path));
      if (entry.type !== "file") continue;
      expect(entry.size, entry.path).toBeGreaterThan(0);
    }
  });

  it("lists the test directory as the single test file", async () => {
    const entries = await gh.listDirectory({
      path: "test",
      ref: await headSha(),
    });

    expect(entries).toEqual([
      expect.objectContaining({
        path: "test/test.js",
        name: "test.js",
        type: "file",
      }),
    ]);
  });
});

describe("fixture error paths", () => {
  it("rejects a file that is not in the fixture", async () => {
    await expect(contentsOf("src/parse.ts")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("rejects a directory that is not in the fixture", async () => {
    await expect(
      gh.listDirectory({ path: "lib", ref: await headSha() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects reading a directory as a file", async () => {
    await expect(contentsOf("test")).rejects.toBeInstanceOf(GitHubApiError);
  });

  it("refuses a file over the cap instead of returning its content", async () => {
    const { content, size } = await gh.getFileContents({
      path: "index.js",
      ref: await headSha(),
      maxBytes: 10,
    });

    expect(content).toBeNull();
    expect(size).toBeGreaterThan(10);
  });

  it("rejects listing a file as a directory", async () => {
    await expect(
      gh.listDirectory({ path: "index.js", ref: await headSha() }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });

  it("returns null for a file the PR does not touch", async () => {
    expect(await gh.getDiff("nope.js")).toBeNull();
    expect(await gh.getFile("nope.js")).toBeNull();
  });
});

describe("fixture issues enrich into rendered code", () => {
  it("anchors every mock issue to lines of its own file", async () => {
    const ref = await headSha();
    const repo = { owner: pr.owner, repo: pr.repo, headSha: ref };
    const changed = (await gh.getPRFiles()).map((file) => file.filename);

    for (const issue of [...mockModelIssues, ...richModelIssues]) {
      expect(changed).toContain(issue.file);

      const enriched = await enrichIssue(gh, repo, issue, log);
      const targets = enriched.codeLines.filter((line) => line.target);
      const lines = await contentLines(issue.file);

      expect(enriched.codeLines.length, issue.file).toBeGreaterThan(0);
      expect(targets.length, issue.file).toBeGreaterThan(0);

      for (const target of targets) {
        expect(target.lineno, `${issue.file} target`).toBeGreaterThanOrEqual(
          issue.line_start,
        );
        expect(target.lineno, `${issue.file} target`).toBeLessThanOrEqual(
          issue.line_end,
        );
      }

      for (const line of enriched.codeLines) {
        if (line.lineno === null) continue;
        expect(lines[line.lineno - 1], `${issue.file}:${line.lineno}`).toBe(
          line.content,
        );
      }
    }
  });
});
