import { describe, expect, it } from "vitest";
import pino from "pino";
import { selectModels, type ModelCandidate } from "./provider";

const log = pino({ level: "silent" });

const USER_KEY = "sk-ant-api03-not-a-real-key";

const identity = (candidate: ModelCandidate) => ({
  provider: candidate.provider,
  modelId: candidate.modelId,
  usesUserKey: candidate.usesUserKey,
});

const budget = (candidate: ModelCandidate) => ({
  modelId: candidate.modelId,
  contextWindow: candidate.contextWindow,
  tpmBudget: candidate.tpmBudget,
  maxOutputTokens: candidate.maxOutputTokens,
});

const chains = [
  { name: "free", key: undefined },
  { name: "BYO", key: USER_KEY },
] as const;

describe("the free chain", () => {
  it("runs Groq, then Cerebras, then Gemini, all on server keys", () => {
    expect(selectModels(undefined, log).map(identity)).toEqual([
      { provider: "groq", modelId: "openai/gpt-oss-120b", usesUserKey: false },
      { provider: "cerebras", modelId: "gpt-oss-120b", usesUserKey: false },
      { provider: "google", modelId: "gemini-2.5-flash", usesUserKey: false },
    ]);
  });
});

describe("the BYO chain", () => {
  it("is Sonnet alone on the user's own key", () => {
    expect(selectModels(USER_KEY, log).map(identity)).toEqual([
      {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        usesUserKey: true,
      },
    ]);
  });
});

describe("the budgets each candidate declares", () => {
  it("are the free chain's documented numbers, and Groq alone is uncapped", () => {
    expect(selectModels(undefined, log).map(budget)).toEqual([
      {
        modelId: "openai/gpt-oss-120b",
        contextWindow: 131_072,
        tpmBudget: 8_000,
        maxOutputTokens: undefined,
      },
      {
        modelId: "gpt-oss-120b",
        contextWindow: 65_536,
        tpmBudget: 30_000,
        maxOutputTokens: 6_000,
      },
      {
        modelId: "gemini-2.5-flash",
        contextWindow: 1_048_576,
        tpmBudget: 250_000,
        maxOutputTokens: 24_000,
      },
    ]);
  });

  it("leave the BYO candidate uncapped", () => {
    expect(selectModels(USER_KEY, log).map(budget)).toEqual([
      {
        modelId: "claude-sonnet-4-6",
        contextWindow: 1_000_000,
        tpmBudget: 2_000_000,
        maxOutputTokens: undefined,
      },
    ]);
  });
});

describe.each(chains)("$name chain ordering", ({ key }) => {
  it("ends on the candidate with the most room", () => {
    const chain = selectModels(key, log);
    expect(chain.length).toBeGreaterThan(0);

    const last = chain[chain.length - 1];

    for (const candidate of chain.slice(0, -1)) {
      expect(last.contextWindow).toBeGreaterThanOrEqual(candidate.contextWindow);
      expect(last.tpmBudget).toBeGreaterThanOrEqual(candidate.tpmBudget);
    }
  });
});
