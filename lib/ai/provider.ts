import "server-only";
import { createCerebras } from "@ai-sdk/cerebras";
import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { env } from "@/lib/env";

export type ProviderName = "cerebras" | "groq" | "google" | "anthropic";

export type ModelCandidate = {
  model: LanguageModel;
  provider: ProviderName;
  modelId: string;
};

export function selectModels(anthropicKey?: string): ModelCandidate[] {
  if (anthropicKey) {
    const anthropic = createAnthropic({
      apiKey: anthropicKey,
      baseURL: "https://api.anthropic.com/v1",
    });
    return [
      {
        model: anthropic("claude-sonnet-4-6"),
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
      },
    ];
  }

  const cerebras = createCerebras({ apiKey: env.CEREBRAS_API_KEY });
  const groq = createGroq({ apiKey: env.GROQ_API_KEY });
  const google = createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  return [
    {
      model: cerebras("zai-glm-4.7"),
      provider: "cerebras",
      modelId: "zai-glm-4.7",
    },
    {
      model: groq("openai/gpt-oss-120b"),
      provider: "groq",
      modelId: "openai/gpt-oss-120b",
    },
    {
      model: google("gemini-2.5-flash"),
      provider: "google",
      modelId: "gemini-2.5-flash",
    },
  ];
}
