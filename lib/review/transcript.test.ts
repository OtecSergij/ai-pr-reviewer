import { describe, it, expect } from "vitest";
import {
  countToolCalls,
  isDegenerateText,
  partiallyReadFiles,
  patchPartOf,
  revealTranscript,
  type TranscriptEntry,
} from "./transcript";
import { REVIEW_TOOL_NAMES } from "./tools/tool-names";

describe("revealTranscript", () => {
  const tool = (toolCallId: string): TranscriptEntry => ({
    kind: "tool",
    toolCallId,
    toolName: REVIEW_TOOL_NAMES.getDiff,
    input: { filename: "index.js" },
    outcome: "ok",
  });

  const failover: TranscriptEntry = {
    kind: "failover",
    from: "groq",
    to: "cerebras",
    reason: "rate-limit",
  };

  it("reveals text up to the budget", () => {
    expect(revealTranscript([{ kind: "text", text: "abcdef" }], 3)).toEqual([
      { kind: "text", text: "abc" },
    ]);
  });

  it("lets events past the cut through in full", () => {
    const entries = [{ kind: "text", text: "abcdef" } as const, tool("a"), failover];

    expect(revealTranscript(entries, 2)).toEqual([
      { kind: "text", text: "ab" },
      tool("a"),
      failover,
    ]);
  });

  it("empties the text that follows the cut instead of dropping it", () => {
    const entries: TranscriptEntry[] = [
      { kind: "text", text: "abcdef" },
      { kind: "reasoning", text: "ghi" },
    ];

    expect(revealTranscript(entries, 2)).toEqual([
      { kind: "text", text: "ab" },
      { kind: "reasoning", text: "" },
    ]);
  });

  it("never counts an unrevealed text entry as a tool call", () => {
    const entries: TranscriptEntry[] = [
      { kind: "text", text: "abcdef" },
      tool("a"),
      { kind: "reasoning", text: "ghi" },
      tool("b"),
    ];

    expect(countToolCalls(revealTranscript(entries, 1))).toBe(2);
    expect(countToolCalls(revealTranscript(entries, 0))).toBe(2);
  });

  it("keeps every entry at its original index for any budget", () => {
    const entries: TranscriptEntry[] = [
      { kind: "text", text: "abc" },
      tool("a"),
      { kind: "reasoning", text: "defgh" },
      failover,
      { kind: "text", text: "ij" },
      tool("b"),
    ];

    for (let budget = 0; budget <= 12; budget += 1) {
      const revealed = revealTranscript(entries, budget);

      expect(revealed).toHaveLength(entries.length);
      revealed.forEach((entry, i) => {
        expect(entry.kind).toBe(entries[i].kind);
        if (entry.kind === "tool" && entries[i].kind === "tool") {
          expect(entry).toBe(entries[i]);
        }
      });
    }
  });

  it("returns the whole transcript once the budget covers it", () => {
    const entries: TranscriptEntry[] = [
      { kind: "text", text: "abc" },
      tool("a"),
      { kind: "reasoning", text: "de" },
    ];

    expect(revealTranscript(entries, 5)).toEqual(entries);
  });
});

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
