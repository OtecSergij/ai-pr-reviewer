import "server-only";
import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

import { parsePRUrl } from "@/lib/github/parse-url";
import { createGithubAccess } from "@/lib/github/octokit";
import { createReviewTools } from "@/lib/review/tools/review-tools";
import { SYSTEM } from "@/lib/review/system-prompt";
import { reviewModel, MODEL } from "@/lib/ai/provider";
import { streamTextMock } from "@/lib/review/mock/stream-text-mock";
import { MAX_CHANGED_FILES, MAX_STEPS } from "@/lib/review/config";
import { env } from "@/lib/env";
import type { Issue } from "@/lib/review/issue";

// MOCK_REVIEW=1 подменяет streamText фикстурным моком — LLM не вызывается,
// но тулзы (GitHub, emit_issue → data-issue) отрабатывают по-настоящему.
const streamTextImpl = env.MOCK_REVIEW ? streamTextMock : streamText;

export async function runReview(
  prUrl: string,
  signal: AbortSignal
): Promise<Response> {
  const pr = parsePRUrl(prUrl);

  const gh = createGithubAccess(env.GITHUB_PAT, pr);

  const { headSha, changedFiles, title } = await gh.getPRMetadata();

  if (changedFiles > MAX_CHANGED_FILES) {
    return new Response(
      `Too many files changed. PR size must be less than ${MAX_CHANGED_FILES} files.`,
      { status: 400 }
    );
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
      // Shell-данные (шапка + сайдбар) — в начале стрима, до агентного потока,
      // чтобы воркспейс отрисовался сразу. getPRFiles кешируется (ensureFiles):
      // модельный get_pr_files_summary переиспользует тот же запрос.
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
        data: await gh.getPRFiles(),
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

      writer.merge(result.toUIMessageStream());
    },
    onFinish: () => {
      console.dir([...UIIssues.values()], { depth: null });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
