import type { InferUIMessageChunk } from "ai";
import type { ReviewUIMessage } from "@/lib/ai/schema/review-stream";
import type { IssueData } from "@/lib/issue";

export type IssuePayload = IssueData;

export type ReviewStatus = "idle" | "running" | "done" | "error" | "aborted";

export type ToolActivity = { toolName: string; input: unknown };

export type ReviewChunk = InferUIMessageChunk<ReviewUIMessage>;
