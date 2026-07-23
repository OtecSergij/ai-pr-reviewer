import { describe, it, expect } from "vitest";
import { countBySeverity } from "./issue-stats";
import type { Issue } from "@/lib/review/issue";

function issue(severity: Issue["severity"]): Issue {
  return {
    id: "id",
    severity,
    title: "t",
    body: "b",
    file: "f.ts",
    lineStart: 1,
    lineEnd: 1,
    blobUrl: "https://example.test/blob",
    language: "ts",
    codeLines: [],
  };
}

describe("countBySeverity", () => {
  it("returns an empty map for no issues", () => {
    const counts = countBySeverity([]);
    expect(counts.size).toBe(0);
  });

  it("counts a single occurrence per severity", () => {
    const counts = countBySeverity([issue("error"), issue("warning"), issue("nit")]);
    expect(counts.get("error")).toBe(1);
    expect(counts.get("warning")).toBe(1);
    expect(counts.get("nit")).toBe(1);
    expect(counts.get("suggestion")).toBeUndefined();
    expect(counts.size).toBe(3);
  });

  it("sums repeated severities", () => {
    const counts = countBySeverity([
      issue("error"),
      issue("error"),
      issue("error"),
      issue("suggestion"),
      issue("suggestion"),
    ]);
    expect(counts.get("error")).toBe(3);
    expect(counts.get("suggestion")).toBe(2);
    expect(counts.size).toBe(2);
  });
});
