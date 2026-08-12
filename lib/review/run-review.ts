import "server-only";
import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  ModelMessage,
  type FinishReason,
} from "ai";

import { parsePRUrl, type PRRef } from "@/lib/github/parse-url";
import {
  createGithubAccess,
  type GithubAccess,
  type PRFileSummary,
} from "@/lib/github/octokit";
import { createReviewTools } from "@/lib/review/tools/review-tools";
import { SYSTEM } from "@/lib/review/system-prompt";
import { selectModels } from "@/lib/ai/provider";
import { MAX_CHANGED_FILES, MAX_STEPS } from "@/lib/review/config";
import { env } from "@/lib/env";
import type { Issue } from "@/lib/review/issue";
import {
  classifyFailure,
  errorToMessage,
  errorToResponse,
  pickVerdict,
  CUT_SHORT_VERDICT,
  type FailureVerdict,
} from "@/lib/review/errors";
import { streamTextMock } from "@/lib/review/mock/stream-text-mock";
import { createFixtureGithubAccess } from "@/lib/review/mock/github-fixture";
import { rateLimitResponse, reviewLimiter } from "@/lib/rate-limit";
import { saveReview } from "@/lib/db/reviews";
import { logger } from "@/lib/log";
import type { ErrorKind } from "@/lib/review/transcript";
import { ReviewUIMessage } from "./stream";

const streamTextImpl = env.MOCK_REVIEW ? streamTextMock : streamText;
const offlineGithub = env.MOCK_REVIEW && env.MOCK_OFFLINE;
const persistMock = env.MOCK_REVIEW && env.MOCK_PERSIST;

export async function runReview({
  prUrl,
  signal,
  anthropicKey,
  githubPat,
  ip,
  requestId,
}: {
  prUrl: string;
  signal: AbortSignal;
  anthropicKey?: string;
  githubPat?: string;
  ip: string;
  requestId: string;
}): Promise<Response> {
  const log = logger.child({ requestId });
  const startedAt = Date.now();
  const candidates = selectModels(anthropicKey, log);

  let pr: PRRef,
    gh: GithubAccess,
    headSha: string,
    title: string,
    isPrivate: boolean,
    prFiles: PRFileSummary[];

  try {
    pr = parsePRUrl(prUrl);

    gh = offlineGithub
      ? createFixtureGithubAccess(pr)
      : createGithubAccess(
          githubPat ?? (env.MOCK_REVIEW ? null : env.GITHUB_PAT),
          pr
        );

    log.info(
      {
        owner: pr.owner,
        repo: pr.repo,
        prNumber: pr.prNumber,
        credential: githubCredential(githubPat),
        mockReview: env.MOCK_REVIEW,
        mockOffline: offlineGithub,
      },
      "github access created"
    );

    const prMetadata = await gh.getPRMetadata();

    if (prMetadata.isPrivate && !githubPat) {
      log.info(
        { owner: pr.owner, repo: pr.repo, prNumber: pr.prNumber },
        "review rejected: private PR without token"
      );
      return new Response(
        "Reviewing a private PR needs your own GitHub token.",
        { status: 403, headers: { "x-review-error": "private" satisfies ErrorKind } }
      );
    }

    if (prMetadata.changedFiles > MAX_CHANGED_FILES) {
      log.info(
        {
          owner: pr.owner,
          repo: pr.repo,
          prNumber: pr.prNumber,
          changedFiles: prMetadata.changedFiles,
        },
        "review rejected: too many changed files"
      );
      return new Response(
        `Too many files changed. PR size must be ${MAX_CHANGED_FILES} files or fewer.`,
        {
          status: 400,
          headers: { "x-review-error": "too-many-files" satisfies ErrorKind },
        }
      );
    }

    headSha = prMetadata.headSha;
    title = prMetadata.title;
    isPrivate = prMetadata.isPrivate;
    prFiles = await gh.getPRFiles();
  } catch (e) {
    const res = errorToResponse(e);
    if (res) {
      log.warn({ err: e }, "review rejected before stream");
      return res;
    }
    throw e;
  }

  if (signal.aborted) {
    return new Response(null, { status: 499 });
  }

  const gate = await reviewLimiter.check(ip);
  if (!gate.allowed) {
    log.info({ retryAfterMs: gate.retryAfterMs }, "review rejected: rate limited");
    return rateLimitResponse(gate);
  }

  const UIIssues = new Map<string, Issue>();

  const messages = [
    {
      role: "user" as const,
      content: `Review this pull request: ${prUrl}`,
    },
  ];

  const repo = { headSha, owner: pr.owner, repo: pr.repo };

  const stream = createUIMessageStream<ReviewUIMessage>({
    execute: async ({ writer }) => {
      writer.write({
        type: "data-files",
        data: prFiles,
        transient: true,
      });

      const tools = createReviewTools(gh, UIIssues, repo, writer, log);
      const streamMessages: ModelMessage[] = [...messages];
      const verdicts: FailureVerdict[] = [];

      for (let i = 0; i < candidates.length; i++) {
        writer.write({
          type: "data-meta",
          data: {
            owner: pr.owner,
            repo: pr.repo,
            prNumber: pr.prNumber,
            title,
            headSha,
            isPrivate,
            model: candidates[i].modelId,
          },
          transient: true,
        });

        let failure: unknown = null;
        let finishReason: FinishReason | null = null;
        let steps = 0;
        let lastStepHadToolCalls = false;
        const stepMessages: ModelMessage[] = [];

        log.info(
          {
            index: i,
            provider: candidates[i].provider,
            modelId: candidates[i].modelId,
            usesUserKey: candidates[i].usesUserKey,
            mockError: env.MOCK_ERROR ?? null,
          },
          "model attempt started"
        );

        const result = streamTextImpl({
          model: candidates[i].model,
          system: SYSTEM,
          messages: streamMessages,
          tools,
          maxOutputTokens: candidates[i].maxOutputTokens,
          stopWhen: candidates[i].usesUserKey ? () => false : stepCountIs(MAX_STEPS),
          abortSignal: signal,
          onError: ({ error }) => {
            failure = error;
          },
          onStepFinish: (step) => {
            steps = step.stepNumber + 1;
            lastStepHadToolCalls = step.toolCalls.some(
              (call) => call.providerExecuted !== true
            );
            stepMessages.push(...step.response.messages);
            log.info(
              {
                provider: candidates[i].provider,
                modelId: candidates[i].modelId,
                stepNumber: step.stepNumber,
                maxOutputTokens: candidates[i].maxOutputTokens ?? null,
                inputTokens: step.usage.inputTokens ?? null,
                outputTokens: step.usage.outputTokens ?? null,
                reasoningTokens:
                  step.usage.outputTokenDetails.reasoningTokens ?? null,
                totalTokens: step.usage.totalTokens ?? null,
                finishReason: step.finishReason,
              },
              "model step usage"
            );
            writer.write({
              type: "data-usage",
              data: {
                tokens: step.usage.totalTokens ?? 0,
              },
              transient: true,
            });
          },
        });

        for await (const chunk of result.toUIMessageStream<ReviewUIMessage>()) {
          if (chunk.type === "error") {
            continue;
          }
          if (chunk.type === "finish") {
            finishReason = chunk.finishReason ?? null;
          }
          writer.write(chunk);
        }

        if (!failure) {
          const exhausted = lastStepHadToolCalls && steps >= MAX_STEPS;
          const cutShort = finishReason === "length" || exhausted;
          const incomplete = finishReason === null || cutShort;

          if (cutShort && i < candidates.length - 1) {
            log.warn(
              {
                from: candidates[i].provider,
                to: candidates[i + 1].provider,
                reason: "too-large",
                finishReason,
                steps,
              },
              "provider failover: output cut short"
            );

            writer.write({
              type: "data-failover",
              transient: true,
              data: {
                from: candidates[i].provider,
                to: candidates[i + 1].provider,
                reason: "too-large",
              },
            });

            verdicts.push(CUT_SHORT_VERDICT);
            streamMessages.push(...sanitizeForHandoff(stepMessages));
            continue;
          }

          const skipped = saveSkipReason(isPrivate, signal.aborted, incomplete);
          let slug: string | null = null;
          let saveFailed = false;

          if (!skipped) {
            try {
              slug = await saveReview(
                {
                  owner: pr.owner,
                  repo: pr.repo,
                  prNumber: pr.prNumber,
                  headSha,
                  prTitle: title,
                  issues: [...UIIssues.values()],
                  provider: candidates[i].modelId,
                },
                log
              );
            } catch (e) {
              log.error(
                {
                  err: e,
                  owner: pr.owner,
                  repo: pr.repo,
                  prNumber: pr.prNumber,
                  headSha,
                },
                "saveReview failed"
              );
              saveFailed = true;
            }

            if (slug) {
              writer.write({
                type: "data-share",
                data: { slug },
                transient: true,
              });
            }
          }

          writer.write({
            type: "data-outcome",
            data: { incomplete, saveFailed },
            transient: true,
          });

          const summary = {
            owner: pr.owner,
            repo: pr.repo,
            prNumber: pr.prNumber,
            provider: candidates[i].modelId,
            issues: UIIssues.size,
            finishReason,
            steps,
            durationMs: Date.now() - startedAt,
          };

          if (slug) {
            log.info({ ...summary, slug }, "review finished");
          } else {
            log.info(
              { ...summary, reason: skipped ?? "save-failed" },
              "review not saved"
            );
          }
          return;
        }

        const knownError = classifyFailure(failure, {
          userKey: candidates[i].usesUserKey,
        });

        if (knownError.reason === "aborted" && signal.aborted) {
          return;
        }

        verdicts.push(knownError);

        if (i < candidates.length - 1 && knownError.hop) {
          log.warn(
            {
              err: failure,
              from: candidates[i].provider,
              to: candidates[i + 1].provider,
              reason: knownError.reason,
            },
            "provider failover"
          );

          writer.write({
            type: "data-failover",
            transient: true,
            data: {
              from: candidates[i].provider,
              to: candidates[i + 1].provider,
              reason: knownError.reason,
            },
          });

          streamMessages.push(...sanitizeForHandoff(stepMessages));
          continue;
        }

        const shown = knownError.hop ? pickVerdict(verdicts) : knownError;

        log.error(
          {
            err: failure,
            reason: knownError.reason,
            shownReason: shown.reason,
            provider: candidates[i].modelId,
          },
          "review failed after providers exhausted"
        );

        writer.write({ type: "error", errorText: shown.message });
        return;
      }
    },
    onError: errorToMessage,
  });

  return createUIMessageStreamResponse({ stream });
}

function githubCredential(githubPat?: string): string {
  if (offlineGithub) return "fixture";
  if (githubPat) return "user-pat";
  return env.MOCK_REVIEW ? "anonymous" : "server-pat";
}

function saveSkipReason(
  isPrivate: boolean,
  aborted: boolean,
  incomplete: boolean
): "private" | "aborted" | "truncated" | "mock" | null {
  if (isPrivate) return "private";
  if (aborted) return "aborted";
  if (incomplete) return "truncated";
  if (env.MOCK_REVIEW && !persistMock) return "mock";
  return null;
}

function sanitizeForHandoff(messages: ModelMessage[]): ModelMessage[] {
  const keptToolCallIds = new Set<string>();
  const out: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === "assistant" && typeof message.content !== "string") {
      const content = message.content
        .filter((p) => p.type !== "reasoning")
        .filter((p) => !(p.type === "text" && p.text === ""));

      if (content.length === 0) {
        continue;
      }

      for (const p of content) {
        if (p.type === "tool-call") keptToolCallIds.add(p.toolCallId);
      }
      out.push({ ...message, content });
      continue;
    }

    if (message.role === "tool") {
      const content = message.content.filter(
        (p) => p.type === "tool-result" && keptToolCallIds.has(p.toolCallId)
      );
      if (content.length === 0) {
        continue;
      }
      out.push({ ...message, content });
      continue;
    }

    out.push(message);
  }

  return out;
}
