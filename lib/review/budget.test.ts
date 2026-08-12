import { describe, expect, it } from "vitest";
import pino from "pino";
import type { ModelMessage } from "ai";
import { budgetCeiling, estimateInputTokens } from "./budget";
import { createReviewTools } from "@/lib/review/tools/review-tools";
import { SYSTEM } from "@/lib/review/system-prompt";

const log = pino({ level: "silent" });

const tools = createReviewTools(
  {} as never,
  new Map(),
  { headSha: "sha", owner: "o", repo: "r" },
  {} as never,
  log
);

const opening: ModelMessage[] = [
  { role: "user", content: "Review this pull request: https://github.com/o/r/pull/1" },
];

const overheadTokens =
  estimateInputTokens(opening, tools) -
  Math.ceil(JSON.stringify(opening).length / 3.5);

describe("the fixed per-request overhead", () => {
  it("counts more than the system prompt, because six tool schemas ride along", () => {
    expect(overheadTokens).toBeGreaterThan(Math.ceil(SYSTEM.length / 3.5));
  });

  it("stays in the band the free budgets were sized against", () => {
    expect(overheadTokens).toBeGreaterThan(2_000);
    expect(overheadTokens).toBeLessThan(3_500);
  });

  it("is recomputed per call, so a changed tool set changes the estimate", () => {
    const wordier = {
      ...tools,
      get_diff: { ...tools.get_diff, description: "d".repeat(7_000) },
    };

    expect(estimateInputTokens(opening, wordier)).toBeGreaterThan(
      estimateInputTokens(opening, tools) + 1_500
    );
  });
});

describe("estimateInputTokens", () => {
  it("grows with the transcript", () => {
    const longer: ModelMessage[] = [
      ...opening,
      { role: "assistant", content: "x".repeat(3_500) },
    ];
    expect(estimateInputTokens(longer, tools)).toBeGreaterThan(
      estimateInputTokens(opening, tools) + 900
    );
  });

  it("reserves the declared output ceiling, because Cerebras charges it at admission", () => {
    expect(estimateInputTokens(opening, tools, 6_000)).toBe(
      estimateInputTokens(opening, tools) + 6_000
    );
  });

  it("reserves nothing for an uncapped candidate", () => {
    expect(estimateInputTokens(opening, tools, undefined)).toBe(
      estimateInputTokens(opening, tools)
    );
  });
});

describe("budgetCeiling", () => {
  it("keeps a fifth of the per-minute budget in reserve", () => {
    expect(budgetCeiling(8_000)).toBe(6_400);
    expect(budgetCeiling(30_000)).toBe(24_000);
    expect(budgetCeiling(250_000)).toBe(200_000);
  });
});

describe("the opening request of a review", () => {
  it("is admitted by every free candidate, so no run swipes before it starts", () => {
    expect(estimateInputTokens(opening, tools)).toBeLessThan(
      budgetCeiling(8_000)
    );
    expect(estimateInputTokens(opening, tools, 6_000)).toBeLessThan(
      budgetCeiling(30_000)
    );
    expect(estimateInputTokens(opening, tools, 24_000)).toBeLessThan(
      budgetCeiling(250_000)
    );
  });
});
