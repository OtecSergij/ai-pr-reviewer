import { REVIEW_TOOL_NAMES } from "@/lib/review/tools/tool-names";
import type { FailoverData } from "@/lib/review/stream";

export type ReviewStatus = "idle" | "running" | "done" | "error" | "aborted";

const ERROR_KINDS = [
  "load",
  "github",
  "rate-limit",
  "provider-quota",
  "api-key",
  "review",
  "private",
  "too-many-files",
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export function isErrorKind(value: string): value is ErrorKind {
  return (ERROR_KINDS as readonly string[]).includes(value);
}

export type ToolOutcome = "running" | "ok" | "skipped" | "failed";

export type TranscriptTextKind = "text" | "reasoning";

export type TranscriptTextEntry = { kind: TranscriptTextKind; text: string };

export type PatchPart = { part: number; totalParts: number };

export type TranscriptEntry =
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      input: unknown;
      outcome: ToolOutcome;
      note?: string;
      patchPart?: PatchPart;
    }
  | TranscriptTextEntry
  | ({ kind: "failover" } & FailoverData);

export function isTextEntry(
  entry: TranscriptEntry,
): entry is TranscriptTextEntry {
  return entry.kind === "text" || entry.kind === "reasoning";
}

const DEGENERATE_TEXT = new Set(["", "None", "null"]);

export function isDegenerateText(text: string): boolean {
  return DEGENERATE_TEXT.has(text.trim());
}

export function totalTextChars(entries: TranscriptEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    if (isTextEntry(entry)) total += entry.text.length;
  }
  return total;
}

export function revealTranscript(
  entries: TranscriptEntry[],
  budget: number,
): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  let remaining = budget;
  for (const entry of entries) {
    if (!isTextEntry(entry)) {
      out.push(entry);
      continue;
    }
    if (entry.text.length <= remaining) {
      remaining -= entry.text.length;
      out.push(entry);
      continue;
    }
    out.push({ kind: entry.kind, text: entry.text.slice(0, remaining) });
    remaining = 0;
  }
  return out;
}

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

export function patchPartOf(output: unknown): PatchPart | null {
  if (output === null || typeof output !== "object") return null;

  const { part, total_parts: totalParts } = output as Record<string, unknown>;

  return typeof part === "number" && typeof totalParts === "number"
    ? { part, totalParts }
    : null;
}

const PART_LIMIT_STATUS = "part_limit";

export function partiallyReadFiles(entries: TranscriptEntry[]): Set<string> {
  const read = new Map<string, { parts: Set<number>; totalParts: number }>();
  const refused = new Set<string>();

  for (const entry of entries) {
    if (entry.kind !== "tool") continue;
    if (entry.toolName !== REVIEW_TOOL_NAMES.getDiff) continue;

    const path = toolPath(entry)?.path;
    if (!path) continue;

    if (!entry.patchPart) {
      if (entry.note === PART_LIMIT_STATUS) refused.add(path);
      continue;
    }

    const seen = read.get(path) ?? {
      parts: new Set<number>(),
      totalParts: entry.patchPart.totalParts,
    };
    seen.parts.add(entry.patchPart.part);
    seen.totalParts = entry.patchPart.totalParts;
    read.set(path, seen);
  }

  const partial = new Set<string>();

  for (const path of refused) {
    if (!read.has(path)) partial.add(path);
  }

  for (const [path, { parts, totalParts }] of read) {
    if (parts.size < totalParts) partial.add(path);
  }

  return partial;
}

export function countToolCalls(transcript: TranscriptEntry[]): number {
  return transcript.filter(
    (e) => e.kind === "tool" && e.toolName !== REVIEW_TOOL_NAMES.emitIssue,
  ).length;
}
