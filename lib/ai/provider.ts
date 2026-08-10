import "server-only";
import { createCerebras } from "@ai-sdk/cerebras";
import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  defaultSettingsMiddleware,
  wrapLanguageModel,
  type LanguageModel,
} from "ai";
import type { Logger } from "pino";
import { env } from "@/lib/env";

export type ProviderName = "cerebras" | "groq" | "google" | "anthropic";

export type ModelCandidate = {
  model: LanguageModel;
  provider: ProviderName;
  modelId: string;
  usesUserKey: boolean;
};

export function selectModels(
  anthropicKey: string | undefined,
  log: Logger
): ModelCandidate[] {
  const candidates = anthropicKey
    ? userKeyChain(anthropicKey)
    : serverKeyChain();

  log.info(
    {
      byo: Boolean(anthropicKey),
      modelIds: candidates.map((candidate) => candidate.modelId),
    },
    "model chain resolved"
  );

  return candidates;
}

function userKeyChain(anthropicKey: string): ModelCandidate[] {
  const anthropic = createAnthropic({
    apiKey: anthropicKey,
    baseURL: "https://api.anthropic.com/v1",
  });

  return [
    {
      model: anthropic("claude-sonnet-4-6"),
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      usesUserKey: true,
    },
  ];
}

function serverKeyChain(): ModelCandidate[] {
  const cerebras = createCerebras({ apiKey: env.CEREBRAS_API_KEY });
  const groq = createGroq({ apiKey: env.GROQ_API_KEY });
  const google = createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  return [
    {
      model: groq("openai/gpt-oss-120b"),
      provider: "groq",
      modelId: "openai/gpt-oss-120b",
      usesUserKey: false,
    },
    {
      model: cerebras("zai-glm-4.7"),
      provider: "cerebras",
      modelId: "zai-glm-4.7",
      usesUserKey: false,
    },
    {
      model: wrapLanguageModel({
        model: google("gemini-2.5-flash"),
        middleware: defaultSettingsMiddleware({
          settings: {
            providerOptions: {
              google: { thinkingConfig: { includeThoughts: true } },
            },
          },
        }),
      }),
      provider: "google",
      modelId: "gemini-2.5-flash",
      usesUserKey: false,
    },
  ];
}
