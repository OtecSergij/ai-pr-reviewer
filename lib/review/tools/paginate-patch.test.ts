import { describe, it, expect } from "vitest";
import { splitPatch } from "./paginate-patch";
import { PATCH_PART_CHARS } from "@/lib/review/config";

function hunk(start: number, length: number): string {
  const header = `@@ -${start},1 +${start},1 @@`;
  return `${header}\n+${"x".repeat(length - header.length - 2)}`;
}

describe("splitPatch", () => {
  it("returns a patch that fits the cap as a single part", () => {
    const patch = [hunk(1, 100), hunk(50, 200)].join("\n");

    expect(splitPatch(patch)).toEqual([patch]);
  });

  it("cuts at hunk boundaries and rejoins into the original patch", () => {
    const first = hunk(1, 1_500);
    const second = hunk(100, 1_500);
    const third = hunk(200, 1_500);
    const patch = [first, second, third].join("\n");

    const parts = splitPatch(patch);

    expect(parts).toEqual([`${first}\n${second}`, third]);
    expect(parts.join("\n")).toBe(patch);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(PATCH_PART_CHARS);
    }
  });

  it("hands back an oversized first hunk whole instead of dropping it", () => {
    const huge = hunk(1, PATCH_PART_CHARS + 1);
    const small = hunk(500, 100);
    const patch = [huge, small].join("\n");

    const parts = splitPatch(patch);

    expect(parts).toEqual([huge, small]);
    expect(parts[0].length).toBeGreaterThan(PATCH_PART_CHARS);
    expect(parts.join("\n")).toBe(patch);
  });

  it("gives an oversized hunk in the middle a part of its own", () => {
    const first = hunk(1, 1_000);
    const huge = hunk(100, PATCH_PART_CHARS + 500);
    const last = hunk(900, 1_000);
    const patch = [first, huge, last].join("\n");

    expect(splitPatch(patch)).toEqual([first, huge, last]);
  });

  it("keeps a patch of exactly the cap whole and splits one char over it", () => {
    const first = hunk(1, 2_000);
    const atCap = [first, hunk(100, PATCH_PART_CHARS - 2_001)].join("\n");
    const overCap = [first, hunk(100, PATCH_PART_CHARS - 2_000)].join("\n");

    expect(atCap.length).toBe(PATCH_PART_CHARS);
    expect(overCap.length).toBe(PATCH_PART_CHARS + 1);
    expect(splitPatch(atCap)).toEqual([atCap]);
    expect(splitPatch(overCap)).toHaveLength(2);
    expect(splitPatch(overCap)[0]).toBe(first);
  });

  it("honours a cap passed by the caller", () => {
    const patch = [hunk(1, 100), hunk(50, 100), hunk(90, 100)].join("\n");

    expect(splitPatch(patch, 201)).toHaveLength(2);
    expect(splitPatch(patch, 100)).toHaveLength(3);
  });

  it("keeps a preamble that precedes the first hunk header", () => {
    const preamble = "--- a/index.js\n+++ b/index.js";
    const patch = [preamble, hunk(1, 3_000), hunk(80, 3_000)].join("\n");

    const parts = splitPatch(patch);

    expect(parts[0].startsWith(preamble)).toBe(true);
    expect(parts.join("\n")).toBe(patch);
  });
});
