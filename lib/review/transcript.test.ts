import { describe, it, expect } from "vitest";
import { isDegenerateText } from "./transcript";

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
