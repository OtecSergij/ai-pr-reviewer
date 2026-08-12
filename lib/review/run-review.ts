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
import { createGithubAccess, type GithubAccess } from "@/lib/github/octokit";
import { createReviewTools } from "@/lib/review/tools/review-tools";
import { isGeneratedPath } from "@/lib/review/tools/generated-path";
import { READING_TOOL_NAMES } from "@/lib/review/tools/tool-names";
import { HANDOFF_NUDGE, SYSTEM } from "@/lib/review/system-prompt";
import { selectModels } from "@/lib/ai/provider";
import { budgetCeiling, estimateInputTokens } from "@/lib/review/budget";
import {
  MAX_CHANGED_FILES,
  MAX_STEPS,
  RAW_CHANGED_FILES_CEILING,
} from "@/lib/review/config";
import { env } from "@/lib/env";
import type { Issue } from "@/lib/review/issue";
import {
  classifyFailure,
  errorKindForReason,
  errorToMessage,
  errorToResponse,
  shownVerdict,
  OUTPUT_TRUNCATED_VERDICT,
  OVER_BUDGET_VERDICT,
  STEPS_EXHAUSTED_VERDICT,
  type FailureReason,
  type FailureVerdict,
} from "@/lib/review/errors";
import { streamTextMock } from "@/lib/review/mock/stream-text-mock";
import { createFixtureGithubAccess } from "@/lib/review/mock/github-fixture";
import { rateLimitResponse, reviewLimiter } from "@/lib/rate-limit";
import { saveReview } from "@/lib/db/reviews";
import { logger } from "@/lib/log";
import type { ErrorKind } from "@/lib/review/transcript";
import { ReviewUIMessage, type ReviewFileSummary } from "./stream";

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
    prFiles: ReviewFileSummary[];

  try {
    pr = parsePRUrl(prUrl);

    const gate = await reviewLimiter.check(ip);
    if (!gate.allowed) {
      log.info(
        { retryAfterMs: gate.retryAfterMs },
        "review rejected: rate limited"
      );
      return rateLimitResponse(gate);
    }

    gh = offlineGithub
      ? createFixtureGithubAccess(pr)
      : createGithubAccess(
          githubPat ?? (env.MOCK_REVIEW ? null : env.GITHUB_PAT),
          pr,
          signal
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

    if (prMetadata.changedFiles > RAW_CHANGED_FILES_CEILING) {
      log.info(
        {
          owner: pr.owner,
          repo: pr.repo,
          prNumber: pr.prNumber,
          changedFiles: prMetadata.changedFiles,
        },
        "review rejected: too many changed files"
      );
      return tooManyFilesResponse(
        `This PR is too large to inspect: it changes over ${RAW_CHANGED_FILES_CEILING} files.`
      );
    }

    headSha = prMetadata.headSha;
    title = prMetadata.title;
    isPrivate = prMetadata.isPrivate;
    prFiles = (await gh.getPRFiles()).map((f) => ({
      ...f,
      generated: isGeneratedPath(f.filename),
    }));

    const reviewableFiles = prFiles.filter((f) => !f.generated).length;

    if (reviewableFiles > MAX_CHANGED_FILES) {
      log.info(
        {
          owner: pr.owner,
          repo: pr.repo,
          prNumber: pr.prNumber,
          changedFiles: prMetadata.changedFiles,
          reviewableFiles,
        },
        "review rejected: too many reviewable files"
      );
      return tooManyFilesResponse(
        `Too many files changed. PR size must be ${MAX_CHANGED_FILES} files or fewer, not counting generated ones.`
      );
    }
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
      let inheritedTranscript = false;

      const inherit = (stepMessages: ModelMessage[]) => {
        streamMessages.push(...sanitizeForHandoff(stepMessages), {
          role: "user",
          content: HANDOFF_NUDGE,
        });
        inheritedTranscript = true;
      };

      const attemptTrail = () =>
        verdicts.map((verdict) => ({
          provider: verdict.provider ?? null,
          modelId: verdict.modelId ?? null,
          reason: verdict.reason,
        }));

      const writeFailover = (index: number, reason: FailureReason) => {
        writer.write({
          type: "data-failover",
          transient: true,
          data: {
            from: candidates[index].provider,
            to: candidates[index + 1].provider,
            reason,
          },
        });
      };

      const failChain = (shown: FailureVerdict) => {
        writer.write({
          type: "data-errorKind",
          transient: true,
          data: { kind: errorKindForReason(shown.reason) },
        });
        writer.write({ type: "error", errorText: shown.message });
      };

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

        const estimate = estimateInputTokens(
          streamMessages,
          tools,
          candidates[i].maxOutputTokens
        );
        const budget = budgetCeiling(candidates[i].tpmBudget);

        if (estimate > budget) {
          verdicts.push({
            ...OVER_BUDGET_VERDICT,
            provider: candidates[i].provider,
            modelId: candidates[i].modelId,
          });

          if (i < candidates.length - 1) {
            log.warn(
              {
                from: candidates[i].provider,
                to: candidates[i + 1].provider,
                reason: OVER_BUDGET_VERDICT.reason,
                estimate,
                budget,
                tpmBudget: candidates[i].tpmBudget,
                maxOutputTokens: candidates[i].maxOutputTokens ?? null,
              },
              "provider failover: estimate over budget"
            );
            writeFailover(i, OVER_BUDGET_VERDICT.reason);
            continue;
          }

          const shown = shownVerdict(verdicts);

          log.error(
            {
              reason: OVER_BUDGET_VERDICT.reason,
              shownReason: shown.reason,
              shownProvider: shown.provider ?? null,
              provider: candidates[i].modelId,
              estimate,
              budget,
              attempts: attemptTrail(),
            },
            "review failed after providers exhausted"
          );

          failChain(shown);
          return;
        }

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
            inputEstimate: estimate,
            budget,
            maxRetries: candidates[i].maxRetries ?? null,
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
          maxRetries: candidates[i].maxRetries,
          stopWhen: candidates[i].usesUserKey ? () => false : stepCountIs(MAX_STEPS),
          prepareStep: inheritedTranscript
            ? ({ stepNumber }) =>
                stepNumber === 0
                  ? { toolChoice: "required", activeTools: READING_TOOL_NAMES }
                  : undefined
            : undefined,
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
            const cut =
              finishReason === "length"
                ? OUTPUT_TRUNCATED_VERDICT
                : STEPS_EXHAUSTED_VERDICT;

            log.warn(
              {
                from: candidates[i].provider,
                to: candidates[i + 1].provider,
                reason: cut.reason,
                finishReason,
                steps,
              },
              "provider failover: output cut short"
            );

            writeFailover(i, cut.reason);

            verdicts.push({
              ...cut,
              provider: candidates[i].provider,
              modelId: candidates[i].modelId,
            });
            inherit(stepMessages);
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

        const knownError: FailureVerdict = {
          ...classifyFailure(failure, {
            userKey: candidates[i].usesUserKey,
          }),
          provider: candidates[i].provider,
          modelId: candidates[i].modelId,
        };

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
              retryAfterSec: knownError.retryAfterSec ?? null,
            },
            "provider failover"
          );

          writeFailover(i, knownError.reason);
          inherit(stepMessages);
          continue;
        }

        const shown = knownError.hop ? shownVerdict(verdicts) : knownError;

        log.error(
          {
            err: failure,
            reason: knownError.reason,
            shownReason: shown.reason,
            shownProvider: shown.provider ?? null,
            provider: candidates[i].modelId,
            retryAfterSec: shown.retryAfterSec ?? null,
            attempts: attemptTrail(),
          },
          "review failed after providers exhausted"
        );

        failChain(shown);
        return;
      }
    },
    onError: (error) => {
      log.error({ err: error }, "review stream failed");
      return errorToMessage(error);
    },
  });

  return createUIMessageStreamResponse({ stream });
}

function tooManyFilesResponse(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "x-review-error": "too-many-files" satisfies ErrorKind },
  });
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
