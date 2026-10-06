import type { ProviderName } from "@/lib/ai/provider";
import type { FailureReason } from "@/lib/review/errors";

export function providerLabel(provider: ProviderName): string {
  switch (provider) {
    case "cerebras":
      return "Cerebras";
    case "groq":
      return "Groq";
    case "google":
      return "Gemini";
    case "anthropic":
      return "Anthropic";
  }
}

const REASON_LABELS: Record<FailureReason, string> = {
  "rate-limit": "hit rate limits",
  "provider-limit": "hit its token budget",
  "over-budget": "can't fit this transcript",
  overloaded: "is overloaded",
  server: "had a server error",
  timeout: "timed out",
  "context-overflow": "ran out of context",
  "output-truncated": "hit its output limit",
  "steps-exhausted": "hit the step ceiling",
  unavailable: "is unavailable",
  auth: "failed",
  "key-rejected": "rejected the key",
  aborted: "failed",
  unknown: "failed",
};

export function reasonLabel(reason: FailureReason): string {
  return REASON_LABELS[reason];
}
