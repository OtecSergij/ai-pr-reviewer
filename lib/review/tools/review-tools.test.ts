import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import type { ToolCallOptions, UIMessageStreamWriter } from "ai";
import type {
  DirectoryEntry,
  FileContents,
  GithubAccess,
  PRFileSummary,
} from "@/lib/github/octokit";
import type { Issue } from "@/lib/review/issue";
import type { ReviewUIMessage } from "@/lib/review/stream";
import type { ModelIssue } from "@/lib/review/model-issue.schema";
import {
  FILE_READ_BUDGET_BYTES,
  MAX_FILE_CONTENTS_BYTES,
  MAX_PARTS_PER_FILE,
  MAX_PART_REPEATS,
  PATCH_PART_CHARS,
  PATCH_READ_BUDGET_CHARS,
} from "@/lib/review/config";
import { createReviewTools } from "./review-tools";

const log = pino({ level: "silent" });
const repo = { owner: "vercel", repo: "ms", headSha: "7c2d4f1" };

const callOptions: ToolCallOptions = {
  toolCallId: "call-1",
  messages: [],
};

function hunk(start: number, length: number): string {
  const header = `@@ -${start},1 +${start},1 @@`;
  return `${header}\n+${"x".repeat(length - header.length - 2)}`;
}

function patchOfParts(count: number): string {
  return Array.from({ length: count }, (_, i) =>
    hunk(i * 100 + 1, PATCH_PART_CHARS),
  ).join("\n");
}

function summary(
  filename: string,
  previousFilename: string | null = null,
): PRFileSummary {
  return {
    filename,
    status: previousFilename ? "renamed" : "modified",
    additions: 1,
    deletions: 1,
    changes: 2,
    previousFilename,
  };
}

function fakeGithub(
  files: PRFileSummary[],
  patches: Map<string, string | null>,
  overrides: Partial<GithubAccess> = {},
): GithubAccess {
  return {
    getPRMetadata: async () => ({
      title: "add weeks",
      body: null,
      changedFiles: files.length,
      headSha: repo.headSha,
      headRef: "weeks",
      baseRef: "main",
      isPrivate: false,
    }),
    getPRFiles: async () => files,
    getFile: async (filename) =>
      files.find((f) => f.filename === filename) ?? null,
    getDiff: async (filename) => patches.get(filename) ?? null,
    getFileContents: async ({ path, ref }): Promise<FileContents> => ({
      path,
      ref,
      content: "",
      size: 0,
      sha: "sha",
    }),
    listDirectory: async (): Promise<DirectoryEntry[]> => [],
    ...overrides,
  };
}

type ReviewTools = ReturnType<typeof createReviewTools>;
type ToolOutput = Record<string, unknown>;

function toolsFor(gh: GithubAccess) {
  const issues = new Map<string, Issue>();
  const writer = {
    write: vi.fn(),
  } as unknown as UIMessageStreamWriter<ReviewUIMessage>;

  return { tools: createReviewTools(gh, issues, repo, writer, log), issues };
}

function callTool(tool: unknown, input: unknown): Promise<ToolOutput> {
  const { execute } = tool as {
    execute?: (input: unknown, options: ToolCallOptions) => Promise<ToolOutput>;
  };

  if (!execute) expect.unreachable("tool has no execute");

  return execute(input, callOptions);
}

const getDiff = (tools: ReviewTools, filename: string, part?: number) =>
  callTool(tools.get_diff, { filename, part });

const issueOn = (file: string): ModelIssue => ({
  file,
  line_start: 1,
  line_end: 2,
  severity: "warning",
  title: "off by one",
  body: "the loop skips the last element",
});

describe("get_diff pagination", () => {
  it("serves the first part when no part is asked for", async () => {
    const { tools } = toolsFor(
      fakeGithub(
        [summary("index.js")],
        new Map([["index.js", patchOfParts(3)]]),
      ),
    );

    expect(await getDiff(tools, "index.js")).toMatchObject({
      part: 1,
      total_parts: 3,
      has_more: true,
      next_part: 2,
    });
  });

  it("closes the last part with has_more false and no next part", async () => {
    const { tools } = toolsFor(
      fakeGithub(
        [summary("index.js")],
        new Map([["index.js", patchOfParts(2)]]),
      ),
    );

    expect(await getDiff(tools, "index.js", 2)).toMatchObject({
      part: 2,
      total_parts: 2,
      has_more: false,
      next_part: null,
    });
  });

  it("hands the whole patch back part by part", async () => {
    const patch = patchOfParts(3);
    const { tools } = toolsFor(
      fakeGithub([summary("index.js")], new Map([["index.js", patch]])),
    );

    const parts: string[] = [];
    for (const part of [1, 2, 3]) {
      const { patch } = await getDiff(tools, "index.js", part);
      if (typeof patch !== "string") {
        expect.unreachable(`part ${part} was refused`);
      }
      parts.push(patch);
    }

    expect(parts.join("\n")).toBe(patch);
  });

  it("answers a part beyond the patch with no_such_part", async () => {
    const { tools } = toolsFor(
      fakeGithub(
        [summary("index.js")],
        new Map([["index.js", patchOfParts(2)]]),
      ),
    );

    expect(await getDiff(tools, "index.js", 7)).toEqual({
      status: "no_such_part",
      total_parts: 2,
    });
  });

  it("serves a single hunk bigger than the cap as one part", async () => {
    const huge = hunk(1, PATCH_PART_CHARS * 2);
    const { tools } = toolsFor(
      fakeGithub([summary("index.js")], new Map([["index.js", huge]])),
    );

    expect(await getDiff(tools, "index.js")).toEqual({
      patch: huge,
      part: 1,
      total_parts: 1,
      has_more: false,
      next_part: null,
    });
  });

  it("keeps not_in_pr and no_patch apart", async () => {
    const { tools } = toolsFor(
      fakeGithub([summary("binary.png")], new Map([["binary.png", null]])),
    );

    expect(await getDiff(tools, "binary.png")).toEqual({ status: "no_patch" });
    expect(await getDiff(tools, "nope.js")).toEqual({ status: "not_in_pr" });
  });
});

describe("get_diff read budget", () => {
  it("stops a file at its part allowance", async () => {
    const { tools } = toolsFor(
      fakeGithub(
        [summary("index.js")],
        new Map([["index.js", patchOfParts(MAX_PARTS_PER_FILE + 2)]]),
      ),
    );

    const last = await getDiff(tools, "index.js", MAX_PARTS_PER_FILE);
    expect(last).toMatchObject({ has_more: true, next_part: null });

    expect(await getDiff(tools, "index.js", MAX_PARTS_PER_FILE + 1)).toEqual({
      status: "part_limit",
      scope: "file",
      total_parts: MAX_PARTS_PER_FILE + 2,
    });
  });

  it("escalates a part that keeps being refused into the repeat guard", async () => {
    const { tools } = toolsFor(
      fakeGithub(
        [summary("package-lock.json")],
        new Map([["package-lock.json", patchOfParts(3)]]),
      ),
    );

    const scopes: unknown[] = [];
    for (let i = 0; i < 8; i++) {
      const { scope } = await getDiff(tools, "package-lock.json", 2);
      scopes.push(scope);
    }

    expect(scopes).toEqual([
      "generated",
      "generated",
      "generated",
      "repeat",
      "repeat",
      "repeat",
      "repeat",
      "repeat",
    ]);
  });

  it("escalates a part that does not exist into the repeat guard", async () => {
    const { tools } = toolsFor(
      fakeGithub(
        [summary("index.js")],
        new Map([["index.js", patchOfParts(2)]]),
      ),
    );

    for (let i = 0; i < MAX_PART_REPEATS; i++) {
      expect(await getDiff(tools, "index.js", 9)).toEqual({
        status: "no_such_part",
        total_parts: 2,
      });
    }

    expect(await getDiff(tools, "index.js", 9)).toEqual({
      status: "part_limit",
      scope: "repeat",
      total_parts: 2,
    });
  });

  it("keeps refusing a part the file allowance stopped, without serving it later", async () => {
    const { tools } = toolsFor(
      fakeGithub(
        [summary("index.js")],
        new Map([["index.js", patchOfParts(MAX_PARTS_PER_FILE + 1)]]),
      ),
    );

    const over = MAX_PARTS_PER_FILE + 1;
    expect(await getDiff(tools, "index.js", over)).toMatchObject({
      scope: "file",
    });
    expect(await getDiff(tools, "index.js", over)).toMatchObject({
      scope: "file",
    });
  });

  it("serves only the first part of a generated file", async () => {
    const { tools } = toolsFor(
      fakeGithub(
        [summary("package-lock.json")],
        new Map([["package-lock.json", patchOfParts(3)]]),
      ),
    );

    expect(await getDiff(tools, "package-lock.json")).toMatchObject({
      part: 1,
      has_more: true,
      next_part: null,
    });
    expect(await getDiff(tools, "package-lock.json", 2)).toEqual({
      status: "part_limit",
      scope: "generated",
      total_parts: 3,
    });
  });

  it("refuses a fourth request for the same part and does not spend budget on repeats", async () => {
    const files = Array.from({ length: 6 }, (_, i) => summary(`f${i}.ts`));
    const patches = new Map(
      files.map((f) => [f.filename, patchOfParts(MAX_PARTS_PER_FILE)]),
    );
    const { tools } = toolsFor(fakeGithub(files, patches));

    for (let i = 0; i < MAX_PART_REPEATS; i++) {
      expect(await getDiff(tools, "f0.ts")).toMatchObject({ part: 1 });
    }

    expect(await getDiff(tools, "f0.ts")).toEqual({
      status: "part_limit",
      scope: "repeat",
      total_parts: MAX_PARTS_PER_FILE,
    });

    expect(await getDiff(tools, "f1.ts")).toMatchObject({ part: 1 });
  });

  it("stops reading once the review's patch budget is spent", async () => {
    const perFile = MAX_PARTS_PER_FILE;
    const fileCount =
      Math.ceil(PATCH_READ_BUDGET_CHARS / (PATCH_PART_CHARS * perFile)) + 1;
    const files = Array.from({ length: fileCount }, (_, i) =>
      summary(`f${i}.ts`),
    );
    const patches = new Map(
      files.map((f) => [f.filename, patchOfParts(perFile)]),
    );
    const { tools } = toolsFor(fakeGithub(files, patches));

    const refusals: unknown[] = [];
    for (const file of files) {
      for (let part = 1; part <= perFile; part++) {
        const { status } = await getDiff(tools, file.filename, part);
        if (status) refusals.push(status);
      }
    }

    expect(refusals.length).toBeGreaterThan(0);
    expect(new Set(refusals)).toEqual(new Set(["part_limit"]));
  });
});

describe("get_pr_files_summary", () => {
  it("reports the part count and the generated flag per file", async () => {
    const { tools } = toolsFor(
      fakeGithub(
        [summary("index.js"), summary("dist/app.min.js"), summary("logo.png")],
        new Map([
          ["index.js", patchOfParts(3)],
          ["dist/app.min.js", patchOfParts(1)],
          ["logo.png", null],
        ]),
      ),
    );

    const { files } = (await callTool(tools.get_pr_files_summary, {})) as {
      files: { filename: string; diff_parts: number; generated: boolean }[];
    };

    expect(
      files.map((f) => ({
        filename: f.filename,
        diff_parts: f.diff_parts,
        generated: f.generated,
      })),
    ).toEqual([
      { filename: "index.js", diff_parts: 3, generated: false },
      { filename: "dist/app.min.js", diff_parts: 1, generated: true },
      { filename: "logo.png", diff_parts: 0, generated: false },
    ]);
  });
});

describe("emit_issue against the changed-file list", () => {
  it("refuses a path the PR does not change", async () => {
    const { tools, issues } = toolsFor(
      fakeGithub(
        [summary("index.js")],
        new Map([["index.js", patchOfParts(1)]]),
      ),
    );

    const result = await callTool(tools.emit_issue, issueOn("src/invented.ts"));

    expect(result).toMatchObject({ status: "not_in_pr" });
    expect(String(result.reason)).toContain("get_pr_files_summary");
    expect(issues.size).toBe(0);
  });

  it("accepts an issue reported against a file's previous name and anchors it to the current one", async () => {
    const { tools, issues } = toolsFor(
      fakeGithub(
        [summary("lib/parse.ts", "src/parse.ts")],
        new Map([["lib/parse.ts", patchOfParts(1)]]),
      ),
    );

    expect(await callTool(tools.emit_issue, issueOn("src/parse.ts"))).toEqual({
      ok: true,
    });

    const [issue] = [...issues.values()];
    expect(issue.file).toBe("lib/parse.ts");
    expect(issue.blobUrl).toContain("lib/parse.ts");
    expect(issue.blobUrl).not.toContain("src/parse.ts");
    expect(issue.codeLines.length).toBeGreaterThan(0);
  });

  it("treats the old and the new name of a renamed file as one issue", async () => {
    const { tools, issues } = toolsFor(
      fakeGithub(
        [summary("lib/parse.ts", "src/parse.ts")],
        new Map([["lib/parse.ts", patchOfParts(1)]]),
      ),
    );

    await callTool(tools.emit_issue, issueOn("src/parse.ts"));

    expect(await callTool(tools.emit_issue, issueOn("lib/parse.ts"))).toEqual({
      ok: true,
      duplicate: true,
    });
    expect(issues.size).toBe(1);
  });

  it("records an issue on a changed file", async () => {
    const { tools, issues } = toolsFor(
      fakeGithub(
        [summary("index.js")],
        new Map([["index.js", patchOfParts(1)]]),
      ),
    );

    expect(await callTool(tools.emit_issue, issueOn("index.js"))).toEqual({
      ok: true,
    });
    expect(issues.size).toBe(1);
  });
});

describe("get_file_contents read budget", () => {
  const READS_TO_EXHAUST = Math.ceil(
    FILE_READ_BUDGET_BYTES / MAX_FILE_CONTENTS_BYTES,
  );

  function servingFullFiles() {
    const content = "x".repeat(MAX_FILE_CONTENTS_BYTES);

    return fakeGithub([summary("index.js")], new Map(), {
      getFileContents: async ({ path, ref }): Promise<FileContents> => ({
        path,
        ref,
        content,
        size: content.length,
        sha: "sha",
      }),
    });
  }

  const readFile = (tools: ReviewTools, path: string) =>
    callTool(tools.get_file_contents, { path });

  it("serves files until the run's byte budget is spent", async () => {
    const { tools } = toolsFor(servingFullFiles());

    for (let i = 0; i < READS_TO_EXHAUST; i++) {
      expect(await readFile(tools, `src/f${i}.ts`)).toMatchObject({
        size: MAX_FILE_CONTENTS_BYTES,
      });
    }

    expect(await readFile(tools, "src/last.ts")).toEqual({
      status: "read_limit",
    });
  });

  it("still hands back a file the run already paid for", async () => {
    const { tools } = toolsFor(servingFullFiles());

    for (let i = 0; i < READS_TO_EXHAUST; i++) {
      await readFile(tools, `src/f${i}.ts`);
    }

    expect(await readFile(tools, "src/f0.ts")).toMatchObject({
      size: MAX_FILE_CONTENTS_BYTES,
    });
  });

  it("charges an oversized file nothing, because it serves none of it", async () => {
    const { tools } = toolsFor(
      fakeGithub([summary("index.js")], new Map(), {
        getFileContents: async ({ path, ref }): Promise<FileContents> => ({
          path,
          ref,
          content: null,
          size: MAX_FILE_CONTENTS_BYTES * 10,
          sha: "sha",
        }),
      }),
    );

    for (let i = 0; i < READS_TO_EXHAUST + 2; i++) {
      expect(await readFile(tools, `src/f${i}.ts`)).toEqual({
        status: "too_large",
      });
    }
  });
});
