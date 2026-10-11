import { describe, expect, it } from "vitest";
import pino from "pino";
import { selectModels, type ModelCandidate } from "./provider";
import { linkLabel } from "@/lib/review/failure-labels";

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
  it("runs Groq, then two OpenRouter models, then Gemini, all on server keys", () => {
    expect(selectModels(undefined, log).map(identity)).toEqual([
      { provider: "groq", modelId: "openai/gpt-oss-120b", usesUserKey: false },
      {
        provider: "openrouter",
        modelId: "nvidia/nemotron-3-super-120b-a12b:free",
        usesUserKey: false,
      },
      {
        provider: "openrouter",
        modelId: "cohere/north-mini-code:free",
        usesUserKey: false,
      },
      {
        provider: "google",
        modelId: "gemini-flash-latest",
        usesUserKey: false,
      },
    ]);
  });
});

describe("the free chain's OpenRouter links", () => {
  const links = () =>
    selectModels(undefined, log).filter(
      (candidate) => candidate.provider === "openrouter",
    );

  it("only ever name free model variants, so the chain cannot bill", () => {
    expect(links().length).toBeGreaterThan(0);

    for (const link of links()) {
      expect(link.modelId.endsWith(":free")).toBe(true);
    }
  });
});

describe("the names the free chain's links go by", () => {
  it("are all different, so a failover line never reads X switching to X", () => {
    const labels = selectModels(undefined, log).map((candidate) =>
      linkLabel(candidate.provider, candidate.modelId),
    );

    expect(new Set(labels).size).toBe(labels.length);
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
        modelId: "nvidia/nemotron-3-super-120b-a12b:free",
        contextWindow: 262_144,
        tpmBudget: 200_000,
        maxOutputTokens: 16_000,
      },
      {
        modelId: "cohere/north-mini-code:free",
        contextWindow: 256_000,
        tpmBudget: 200_000,
        maxOutputTokens: 16_000,
      },
      {
        modelId: "gemini-flash-latest",
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
      expect(last.contextWindow).toBeGreaterThanOrEqual(
        candidate.contextWindow,
      );
      expect(last.tpmBudget).toBeGreaterThanOrEqual(candidate.tpmBudget);
    }
  });
});

describe.each(chains)("$name chain retries", ({ key }) => {
  it("retries only where a retry is the last resort", () => {
    const chain = selectModels(key, log);
    const last = chain[chain.length - 1];

    for (const candidate of chain.slice(0, -1)) {
      expect(candidate.maxRetries).toBe(0);
    }

    expect(last.maxRetries).toBeUndefined();
  });
});
