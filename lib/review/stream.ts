import { UIMessage } from "ai";
import type { Issue } from "./issue";
import type { PRFileStatus, PRFileSummary } from "@/lib/github/octokit";

export type { PRFileStatus, PRFileSummary };

export const ISSUE_DATA_KEY = "issue" as const;

export type PRMeta = {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  headSha: string;
  // TODO(тема 8): динамический provider/model вместо хардкода в route
  model: string;
};

export type ReviewUIMessage = UIMessage<
  never,
  { meta: PRMeta; files: PRFileSummary[] } & {
    [K in typeof ISSUE_DATA_KEY]: Issue;
  }
>;
