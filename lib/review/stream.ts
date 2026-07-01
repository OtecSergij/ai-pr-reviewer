import { UIMessage } from "ai";
import type { Issue } from "./issue";
import type { PRFileStatus, PRFileSummary } from "@/lib/github/octokit";
import type { ProviderName } from "@/lib/ai/provider";
import type { FailureReason } from "@/lib/review/errors";

export type { PRFileStatus, PRFileSummary };

export const ISSUE_DATA_KEY = "issue" as const;

export type FailoverData = {
  from: ProviderName;
  to: ProviderName;
  reason: FailureReason;
};

export type UsageData = { tokens: number };

export type PRMeta = {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  headSha: string;
  model: string;
};

export type ReviewUIMessage = UIMessage<
  never,
  { meta: PRMeta; files: PRFileSummary[]; failover: FailoverData; usage: UsageData } & {
    [K in typeof ISSUE_DATA_KEY]: Issue;
  }
>;
