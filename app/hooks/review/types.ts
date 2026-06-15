import type { InferUIMessageChunk } from "ai";
import type { PRMeta, ReviewUIMessage } from "@/lib/ai/schema/review-stream";
import type { IssueData } from "@/lib/issue";
import type { PRFileSummary } from "@/lib/github/octokit";

export type IssuePayload = IssueData;
export type { PRMeta, PRFileSummary };

export type ReviewStatus = "idle" | "running" | "done" | "error" | "aborted";

export type ToolActivity = { toolName: string; input: unknown };

export type ReviewChunk = InferUIMessageChunk<ReviewUIMessage>;
