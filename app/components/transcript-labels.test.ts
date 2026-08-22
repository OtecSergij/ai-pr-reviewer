import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { statusLabel } from "./transcript-labels";

const toolStatuses = (): string[] => {
  const source = readFileSync(
    new URL("../../lib/review/tools/review-tools.ts", import.meta.url),
    "utf8",
  );
  const found = Array.from(
    source.matchAll(/status: "([a-z_]+)"/g),
    (m) => m[1],
  );
  return [...new Set(found)];
};

const KNOWN_STATUSES = [
  "not_found",
  "no_patch",
  "not_in_pr",
  "lines_not_in_diff",
  "retry_limit",
  "too_large",
  "no_such_part",
  "part_limit",
  "read_limit",
  "unavailable",
];

describe("statusLabel covers every status the tools return", () => {
  it("leaves no tool status showing as a raw snake_case name", () => {
    const statuses = toolStatuses();
    expect(statuses).toEqual(expect.arrayContaining(KNOWN_STATUSES));

    expect(
      statuses.filter((status) => statusLabel(status).includes("_")),
    ).toEqual([]);
  });
});
