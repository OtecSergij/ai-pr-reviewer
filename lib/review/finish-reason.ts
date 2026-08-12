import type { FinishReason } from "ai";
import type { ReviewChunk } from "@/lib/review/stream";

export function nextFinishReason(
  current: FinishReason | null,
  chunk: ReviewChunk
): FinishReason | null {
  if (chunk.type === "data-meta") return null;
  if (chunk.type === "finish") return chunk.finishReason ?? null;
  return current;
}
