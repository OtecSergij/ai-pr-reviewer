import type { ProviderName } from "@/lib/ai/provider";
import type { FailureReason } from "@/lib/review/errors";

/**
 * How a provider and a failure are named for a human.
 *
 * Shared on purpose: the agent console narrates every hop with these words
 * ("Groq hit rate limits — switching to Cerebras"), and the error banner ends
 * the same story with the link that had nowhere left to hand off to. One map,
 * so the last line cannot drift from the ones above it.
 *
 * Deliberately free of `server-only`: a client component and the server-side
 * message builder both import it. The two type imports are erased, so this
 * stays a leaf module and `lib/review/errors.ts` can import it back.
 */
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
