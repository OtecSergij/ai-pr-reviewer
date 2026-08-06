import { describe, it, expect } from "vitest";
import { isGeneratedPath } from "./generated-path";

describe("isGeneratedPath", () => {
  it("flags files inside generated directories", () => {
    expect(isGeneratedPath("dist/lodash.min.js")).toBe(true);
    expect(isGeneratedPath("build/index.js")).toBe(true);
    expect(isGeneratedPath("vendor/foo.go")).toBe(true);
  });

  it("flags lockfiles and source maps", () => {
    expect(isGeneratedPath("package-lock.json")).toBe(true);
    expect(isGeneratedPath("app.js.map")).toBe(true);
  });

  it("matches whole path segments only", () => {
    expect(isGeneratedPath("src/dist-utils.ts")).toBe(false);
    expect(isGeneratedPath("dist")).toBe(false);
  });

  it("leaves hand-written files alone", () => {
    expect(isGeneratedPath("lodash.js")).toBe(false);
    expect(isGeneratedPath("README.md")).toBe(false);
  });
});
