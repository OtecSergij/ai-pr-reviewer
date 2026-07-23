import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "./diff";

describe("parseUnifiedDiff", () => {
  it("assigns line numbers across a single hunk", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " ctx",
      "-gone",
      "+new",
      " tail",
    ].join("\n");

    const hunks = parseUnifiedDiff(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].newStart).toBe(1);
    expect(hunks[0].newEnd).toBe(4);
    expect(hunks[0].lines).toEqual([
      { kind: "context", content: "ctx", oldLineno: 1, newLineno: 1 },
      { kind: "removed", content: "gone", oldLineno: 2, newLineno: null },
      { kind: "added", content: "new", oldLineno: null, newLineno: 2 },
      { kind: "context", content: "tail", oldLineno: 3, newLineno: 3 },
    ]);
  });

  it("defaults newCount to 1 when the header omits counts", () => {
    const hunks = parseUnifiedDiff(["@@ -1 +1 @@", "+only"].join("\n"));
    expect(hunks[0].newStart).toBe(1);
    expect(hunks[0].newEnd).toBe(1);
    expect(hunks[0].lines).toEqual([
      { kind: "added", content: "only", oldLineno: null, newLineno: 1 },
    ]);
  });

  it("parses several hunks with independent counters", () => {
    const patch = [
      "@@ -1,1 +1,1 @@",
      " a",
      "@@ -10,1 +20,2 @@",
      " b",
      "+c",
    ].join("\n");

    const hunks = parseUnifiedDiff(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[1].newStart).toBe(20);
    expect(hunks[1].newEnd).toBe(21);
    expect(hunks[1].lines).toEqual([
      { kind: "context", content: "b", oldLineno: 10, newLineno: 20 },
      { kind: "added", content: "c", oldLineno: null, newLineno: 21 },
    ]);
  });

  it("strips a trailing carriage return from content", () => {
    const hunks = parseUnifiedDiff(["@@ -1 +1 @@", "+with cr\r"].join("\n"));
    expect(hunks[0].lines[0].content).toBe("with cr");
  });

  it("skips the no-newline marker line", () => {
    const patch = [
      "@@ -1 +1 @@",
      "+text",
      "\\ No newline at end of file",
    ].join("\n");

    const hunks = parseUnifiedDiff(patch);
    expect(hunks[0].lines).toEqual([
      { kind: "added", content: "text", oldLineno: null, newLineno: 1 },
    ]);
  });

  it("tolerates a trailing empty line", () => {
    const hunks = parseUnifiedDiff("@@ -1 +1 @@\n+text\n");
    expect(hunks[0].lines).toHaveLength(1);
    expect(hunks[0].lines[0].content).toBe("text");
  });

  it("throws on a malformed hunk header", () => {
    expect(() => parseUnifiedDiff("@@ garbage @@")).toThrow(
      /malformed hunk header/,
    );
  });

  it("throws when a diff line precedes any hunk header", () => {
    expect(() => parseUnifiedDiff("+orphan\n@@ -1 +1 @@")).toThrow(
      /diff line before hunk header/,
    );
  });
});
