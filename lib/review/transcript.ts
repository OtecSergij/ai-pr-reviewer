import { REVIEW_TOOL_NAMES } from "@/lib/review/tools/tool-names";

export type ReviewStatus = "idle" | "running" | "done" | "error" | "aborted";

export type TranscriptEntry =
  | { kind: "tool"; toolName: string; input: unknown }
  | { kind: "text"; text: string };

export type ToolPath = { path: string; type: "file" | "dir" };

export function toolPath(entry: TranscriptEntry): ToolPath | null {
  if (entry.kind !== "tool") return null;
  const i = entry.input as Record<string, unknown> | undefined;
  switch (entry.toolName) {
    case REVIEW_TOOL_NAMES.getDiff:
      return i?.filename ? { path: String(i.filename), type: "file" } : null;
    case REVIEW_TOOL_NAMES.getFileContents:
      return i?.path ? { path: String(i.path), type: "file" } : null;
    case REVIEW_TOOL_NAMES.listDirectory:
      return i?.path ? { path: String(i.path), type: "dir" } : null;
    default:
      return null;
  }
}

export function countSteps(transcript: TranscriptEntry[]): number {
  return transcript.filter(
    (e) => e.kind === "tool" && e.toolName !== REVIEW_TOOL_NAMES.emitIssue
  ).length;
}
