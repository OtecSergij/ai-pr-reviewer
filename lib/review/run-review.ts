import "server-only";
import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

import { parsePRUrl, type PRRef } from "@/lib/github/parse-url";
import {
  createGithubAccess,
  type GithubAccess,
  type PRFileSummary,
} from "@/lib/github/octokit";
import { createReviewTools } from "@/lib/review/tools/review-tools";
import { SYSTEM } from "@/lib/review/system-prompt";
import { reviewModel, MODEL } from "@/lib/ai/provider";
import { streamTextMock } from "@/lib/review/mock/stream-text-mock";
import { MAX_CHANGED_FILES, MAX_STEPS } from "@/lib/review/config";
import { env } from "@/lib/env";
import type { Issue } from "@/lib/review/issue";
import { errorToMessage, errorToResponse } from "@/lib/review/errors";

const streamTextImpl = env.MOCK_REVIEW ? streamTextMock : streamText;

export async function runReview(
  prUrl: string,
  signal: AbortSignal
): Promise<Response> {
  let pr: PRRef,
    gh: GithubAccess,
    headSha: string,
    title: string,
    prFiles: PRFileSummary[];

  try {
    pr = parsePRUrl(prUrl);

    gh = createGithubAccess(env.GITHUB_PAT, pr);

    const prMetadata = await gh.getPRMetadata();

    if (prMetadata.changedFiles > MAX_CHANGED_FILES) {
      return new Response(
        `Too many files changed. PR size must be less than ${MAX_CHANGED_FILES} files.`,
        { status: 400 }
      );
    }

    headSha = prMetadata.headSha;
    title = prMetadata.title;
    prFiles = await gh.getPRFiles();
  } catch (e) {
    const res = errorToResponse(e);
    if (res) return res;
    throw e;
  }

  const UIIssues = new Map<string, Issue>();

  const messages = [
    {
      role: "user" as const,
      content: `Review this pull request: ${prUrl}`,
    },
  ];

  const repo = { headSha, owner: pr.owner, repo: pr.repo };

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({
        type: "data-meta",
        data: {
          owner: pr.owner,
          repo: pr.repo,
          prNumber: pr.prNumber,
          title,
          headSha,
          model: MODEL,
        },
        transient: true,
      });
      writer.write({
        type: "data-files",
        data: prFiles,
        transient: true,
      });

      const tools = createReviewTools(gh, UIIssues, repo, writer);

      const result = streamTextImpl({
        model: reviewModel,
        system: SYSTEM,
        messages,
        tools,
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal: signal,
      });

      writer.merge(result.toUIMessageStream({ onError: errorToMessage }));
    },
    onError: errorToMessage,
  });

  return createUIMessageStreamResponse({ stream });
}
