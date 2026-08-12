import { REVIEW_TOOL_NAMES } from "@/lib/review/tools/tool-names";
import type { ProviderName } from "@/lib/ai/provider";
import type { FailureReason } from "@/lib/review/errors";
import type { PatchPart } from "@/lib/review/transcript";

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
  aborted: "failed",
  unknown: "failed",
};

export function reasonLabel(reason: FailureReason): string {
  return REASON_LABELS[reason];
}

export function toolLabel(
  toolName: string,
  input: unknown
): { label: string; detail: string } {
  const i = input as Record<string, unknown> | undefined;
  switch (toolName) {
    case REVIEW_TOOL_NAMES.getPrMetadata:
      return { label: "Reading PR metadata", detail: "" };
    case REVIEW_TOOL_NAMES.getPrFilesSummary:
      return { label: "Reading changed files", detail: "" };
    case REVIEW_TOOL_NAMES.getDiff:
      return { label: "Reading diff", detail: String(i?.filename ?? "") };
    case REVIEW_TOOL_NAMES.getFileContents:
      return { label: "Reading file", detail: String(i?.path ?? "") };
    case REVIEW_TOOL_NAMES.listDirectory:
      return { label: "Listing directory", detail: String(i?.path ?? "") };
    default:
      return { label: "Reviewing", detail: "" };
  }
}

export function statusLabel(status?: string): string {
  switch (status) {
    case "not_found":
      return "not found";
    case "no_patch":
      return "no patch";
    case "not_in_pr":
      return "not in PR";
    case "too_large":
      return "too large";
    case "no_such_part":
      return "no such part";
    case "part_limit":
      return "read limit reached";
    case "unavailable":
      return "unavailable";
    default:
      return status ?? "skipped";
  }
}

export function partLabel(patchPart?: PatchPart): string {
  if (!patchPart || patchPart.totalParts < 2) return "";
  return `part ${patchPart.part}/${patchPart.totalParts}`;
}
