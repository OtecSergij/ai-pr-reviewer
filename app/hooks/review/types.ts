import type { InferUIMessageChunk } from "ai";
import type { ModelIssue, ReviewUIMessage } from "@/lib/ai/schema/modelIssue";

export type IssuePayload = ModelIssue;

export type ReviewStatus = "idle" | "running" | "done" | "error" | "aborted";

export type ToolActivity = { toolName: string; input: unknown };

export type ReviewChunk = InferUIMessageChunk<ReviewUIMessage>;
