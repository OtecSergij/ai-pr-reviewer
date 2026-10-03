import { REVIEW_TOOL_NAMES } from "@/lib/review/tools/tool-names";
import type { PatchPart } from "@/lib/review/transcript";

// The console narrates the hops; lib/review/errors.ts ends the story with
// the same words. Re-exported so callers here keep one import site.
export { providerLabel, reasonLabel } from "@/lib/review/failure-labels";

export function toolLabel(
  toolName: string,
  input: unknown,
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
    case "lines_not_in_diff":
      return "lines not in diff";
    case "too_large":
      return "too large";
    case "no_such_part":
      return "no such part";
    case "part_limit":
    case "read_limit":
      return "read limit reached";
    case "retry_limit":
      return "retry limit reached";
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
