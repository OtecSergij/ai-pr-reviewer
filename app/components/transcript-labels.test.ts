import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { linkLabel, statusLabel } from "./transcript-labels";

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

describe("linkLabel names the chain link a failover divider talks about", () => {
  it("uses the provider's name where the provider serves one link", () => {
    expect(linkLabel("groq", "openai/gpt-oss-120b")).toBe("Groq");
    expect(linkLabel("google", "gemini-flash-latest")).toBe("Gemini");
  });

  it("tells the two OpenRouter links apart by their models", () => {
    expect(
      linkLabel("openrouter", "nvidia/nemotron-3-super-120b-a12b:free"),
    ).toBe("Nemotron");
    expect(linkLabel("openrouter", "cohere/north-mini-code:free")).toBe(
      "North",
    );
  });

  it("falls back to the provider's name for a model it has no name for", () => {
    expect(linkLabel("openrouter", "qwen/qwen3.8-27b:free")).toBe("OpenRouter");
    expect(linkLabel("openrouter")).toBe("OpenRouter");
  });
});
