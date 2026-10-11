import "server-only";
import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  defaultSettingsMiddleware,
  wrapLanguageModel,
  type LanguageModel,
} from "ai";
import type { Logger } from "pino";
import { env } from "@/lib/env";
import { tracedFetch, waitingOutRateLimit } from "@/lib/ai/provider-fetch";

export type ProviderName = "groq" | "openrouter" | "google" | "anthropic";

export type ModelCandidate = {
  model: LanguageModel;
  provider: ProviderName;
  modelId: string;
  usesUserKey: boolean;
  contextWindow: number;
  tpmBudget: number;
  maxOutputTokens?: number;
  maxRetries?: number;
};

export function selectModels(
  anthropicKey: string | undefined,
  log: Logger,
): ModelCandidate[] {
  const candidates = anthropicKey
    ? userKeyChain(anthropicKey, log)
    : serverKeyChain(log);

  log.info(
    {
      byo: Boolean(anthropicKey),
      modelIds: candidates.map((candidate) => candidate.modelId),
    },
    "model chain resolved",
  );

  return candidates;
}

function userKeyChain(anthropicKey: string, log: Logger): ModelCandidate[] {
  const anthropic = createAnthropic({
    apiKey: anthropicKey,
    baseURL: "https://api.anthropic.com/v1",
    fetch: tracedFetch("anthropic", log),
  });

  return [
    {
      model: anthropic("claude-sonnet-4-6"),
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      usesUserKey: true,
      contextWindow: 1_000_000,
      tpmBudget: 2_000_000,
    },
  ];
}

function serverKeyChain(log: Logger): ModelCandidate[] {
  const groq = createGroq({
    apiKey: env.GROQ_API_KEY,
    fetch: tracedFetch("groq", log),
  });
  const openrouter = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: env.OPENROUTER_API_KEY,
    fetch: waitingOutRateLimit(
      "openrouter",
      log,
      tracedFetch("openrouter", log),
    ),
  });
  const google = createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    fetch: tracedFetch("google", log),
  });

  return [
    {
      model: groq("openai/gpt-oss-120b"),
      provider: "groq",
      modelId: "openai/gpt-oss-120b",
      usesUserKey: false,
      contextWindow: 131_072,
      tpmBudget: 8_000,
      maxRetries: 0,
    },
    {
      model: openrouter("nvidia/nemotron-3-super-120b-a12b:free"),
      provider: "openrouter",
      modelId: "nvidia/nemotron-3-super-120b-a12b:free",
      usesUserKey: false,
      contextWindow: 262_144,
      tpmBudget: 200_000,
      maxOutputTokens: 16_000,
      maxRetries: 0,
    },
    {
      model: openrouter("cohere/north-mini-code:free"),
      provider: "openrouter",
      modelId: "cohere/north-mini-code:free",
      usesUserKey: false,
      contextWindow: 256_000,
      tpmBudget: 200_000,
      maxOutputTokens: 16_000,
      maxRetries: 0,
    },
    {
      model: wrapLanguageModel({
        model: google("gemini-flash-latest"),
        middleware: defaultSettingsMiddleware({
          settings: {
            providerOptions: {
              google: { thinkingConfig: { includeThoughts: true } },
            },
          },
        }),
      }),
      provider: "google",
      modelId: "gemini-flash-latest",
      usesUserKey: false,
      contextWindow: 1_048_576,
      tpmBudget: 250_000,
      maxOutputTokens: 24_000,
    },
  ];
}
