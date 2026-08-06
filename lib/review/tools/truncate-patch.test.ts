import { describe, it, expect } from "vitest";
import { truncatePatch } from "./truncate-patch";

const PATCH_CAP = 4_000;

function hunk(start: number, length: number): string {
  const header = `@@ -${start},1 +${start},1 @@`;
  return `${header}\n+${"x".repeat(length - header.length - 2)}`;
}

describe("truncatePatch", () => {
  it("returns a patch that fits the cap unchanged", () => {
    const patch = [hunk(1, 100), hunk(50, 200)].join("\n");

    expect(truncatePatch(patch)).toEqual({ patch, patchTruncated: false });
  });

  it("cuts at a hunk boundary and keeps the leading hunks byte-identical", () => {
    const first = hunk(1, 1_500);
    const second = hunk(100, 1_500);
    const third = hunk(200, 1_500);
    const patch = [first, second, third].join("\n");

    const result = truncatePatch(patch);

    expect(result.patchTruncated).toBe(true);
    expect(result.patch).toBe(`${first}\n${second}`);
    expect(patch.startsWith(result.patch)).toBe(true);
    expect(result.patch.length).toBeLessThanOrEqual(PATCH_CAP);
  });

  it("returns an empty patch when the first hunk alone is over the cap", () => {
    const patch = [hunk(1, PATCH_CAP + 1), hunk(500, 100)].join("\n");

    expect(truncatePatch(patch)).toEqual({ patch: "", patchTruncated: true });
  });

  it("keeps a patch of exactly the cap and cuts one byte over it", () => {
    const first = hunk(1, 2_000);
    const atCap = [first, hunk(100, PATCH_CAP - 2_001)].join("\n");
    const overCap = [first, hunk(100, PATCH_CAP - 2_000)].join("\n");

    expect(atCap.length).toBe(PATCH_CAP);
    expect(overCap.length).toBe(PATCH_CAP + 1);
    expect(truncatePatch(atCap)).toEqual({
      patch: atCap,
      patchTruncated: false,
    });
    expect(truncatePatch(overCap)).toEqual({
      patch: first,
      patchTruncated: true,
    });
  });
});
