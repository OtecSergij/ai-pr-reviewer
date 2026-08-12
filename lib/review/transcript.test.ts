import { describe, it, expect } from "vitest";
import {
  isDegenerateText,
  partiallyReadFiles,
  patchPartOf,
  type TranscriptEntry,
} from "./transcript";
import { REVIEW_TOOL_NAMES } from "./tools/tool-names";

describe("isDegenerateText", () => {
  it("treats a bare None as degenerate", () => {
    expect(isDegenerateText("None")).toBe(true);
  });

  it("treats a bare null as degenerate", () => {
    expect(isDegenerateText("null")).toBe(true);
  });

  it("treats an empty block as degenerate", () => {
    expect(isDegenerateText("")).toBe(true);
  });

  it("treats a whitespace-only block as degenerate", () => {
    expect(isDegenerateText("   ")).toBe(true);
  });

  it("keeps a sentence that starts with None", () => {
    expect(isDegenerateText("None of the callers check this.")).toBe(false);
  });

  it("keeps other short words", () => {
    expect(isDegenerateText("nothing")).toBe(false);
  });
});

describe("patchPartOf", () => {
  it("reads the part numbers off a served patch", () => {
    expect(patchPartOf({ patch: "@@", part: 2, total_parts: 4 })).toEqual({
      part: 2,
      totalParts: 4,
    });
  });

  it("ignores a refusal that only states the total", () => {
    expect(patchPartOf({ status: "no_such_part", total_parts: 4 })).toBeNull();
    expect(patchPartOf(null)).toBeNull();
    expect(patchPartOf({ content: "x", size: 1 })).toBeNull();
  });
});

describe("partiallyReadFiles", () => {
  const diffEntry = (
    filename: string,
    part: number,
    totalParts: number
  ): TranscriptEntry => ({
    kind: "tool",
    toolCallId: `${filename}:${part}`,
    toolName: REVIEW_TOOL_NAMES.getDiff,
    input: { filename, part },
    outcome: "ok",
    patchPart: { part, totalParts },
  });

  it("marks a file whose parts were left unread", () => {
    expect(
      partiallyReadFiles([diffEntry("index.js", 1, 3)])
    ).toEqual(new Set(["index.js"]));
  });

  it("clears a file once every part has been served", () => {
    expect(
      partiallyReadFiles([
        diffEntry("index.js", 1, 2),
        diffEntry("index.js", 2, 2),
      ])
    ).toEqual(new Set());
  });

  it("counts distinct parts, not the number of calls", () => {
    expect(
      partiallyReadFiles([
        diffEntry("index.js", 1, 2),
        diffEntry("index.js", 1, 2),
      ])
    ).toEqual(new Set(["index.js"]));
  });

  const refusedEntry = (filename: string, note: string): TranscriptEntry => ({
    kind: "tool",
    toolCallId: `${filename}:${note}`,
    toolName: REVIEW_TOOL_NAMES.getDiff,
    input: { filename },
    outcome: "skipped",
    note,
  });

  it("marks a file whose only read was refused by the budget", () => {
    expect(partiallyReadFiles([refusedEntry("big.ts", "part_limit")])).toEqual(
      new Set(["big.ts"])
    );
  });

  it("leaves a fully read file alone when a repeat is refused afterwards", () => {
    expect(
      partiallyReadFiles([
        diffEntry("index.js", 1, 1),
        refusedEntry("index.js", "part_limit"),
      ])
    ).toEqual(new Set());
  });

  it("says nothing about a file that simply has no diff", () => {
    expect(partiallyReadFiles([refusedEntry("logo.png", "no_patch")])).toEqual(
      new Set()
    );
  });

  it("ignores tools that serve no patch parts", () => {
    const entry: TranscriptEntry = {
      kind: "tool",
      toolCallId: "contents",
      toolName: REVIEW_TOOL_NAMES.getFileContents,
      input: { path: "index.js" },
      outcome: "ok",
    };

    expect(partiallyReadFiles([entry])).toEqual(new Set());
  });
});
