import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

import { parsePRUrl } from "@/lib/github/parse-url";
import { createGithubAccess } from "@/lib/github/octokit";
import { makeReviewTools } from "@/lib/ai/tools/review";
import { SYSTEM } from "@/lib/ai/system-prompt";
import { env } from "@/lib/env";
import { streamTextMock } from "@/lib/ai/mock/stream-text-mock";
import type { IssueData } from "@/lib/issue";

// ВРЕМЕННО (прогон темы 5): Sonnet 4.6 через AITunnel-прокси (нативный
// Anthropic endpoint /v1/messages). Откат: import { groq } from "@ai-sdk/groq"
// и model: groq("meta-llama/llama-4-scout-17b-16e-instruct").
// Постоянная конфигурация провайдеров — тема 8.
const anthropic = createAnthropic({
  baseURL: "https://api.aitunnel.ru/v1",
  // AITunnel принимает токен только как `Authorization: Bearer` —
  // authToken шлёт его так; apiKey (x-api-key) они отвергают с 401.
  authToken: env.AI_TUNNEL_API_KEY,
});

// TODO(тема 8): динамический выбор провайдера/модели. Пока единая точка истины
// для вызова модели и для лейбла в шапке UI (meta.model).
const MODEL = "claude-sonnet-4-6";

// ВРЕМЕННО (итерации по UI): MOCK_REVIEW=1 подменяет streamText фикстурным
// моком — LLM не вызывается, но тулзы (GitHub, emit_issue → data-issue)
// отрабатывают по-настоящему. В форму вставлять MOCK_PR_URL из lib/ai/mock.
const streamTextImpl = env.MOCK_REVIEW ? streamTextMock : streamText;

export async function POST(req: Request) {
  const { pr_url } = await req.json();

  const pr = parsePRUrl(pr_url);

  const gh = createGithubAccess(env.GITHUB_PAT, pr);

  const { head_sha, changed_files, title } = await gh.getPRMetadata();

  if (changed_files > 15) {
    return new Response(
      "Too many files changed. PR size must be less than 15 files.",
      { status: 400 }
    );
  }

  const UIIssues: Map<string, IssueData> = new Map();

  const messages = [
    {
      role: "user" as const,
      content: `Review this pull request: ${pr_url}`,
    },
  ];

  const repo = { headSha: head_sha, owner: pr.owner, repo: pr.repo };

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
          pr_number: pr.pr_number,
          title,
          head_sha,
          model: MODEL,
        },
        transient: true,
      });
      writer.write({
        type: "data-files",
        data: await gh.getPRFiles(),
        transient: true,
      });

      const tools = makeReviewTools(gh, UIIssues, repo, writer);

      const result = streamTextImpl({
        model: anthropic(MODEL),
        system: SYSTEM,
        messages,
        tools,
        stopWhen: stepCountIs(60),
        abortSignal: req.signal,
      });

      writer.merge(result.toUIMessageStream());
    },
    onFinish: () => {
      console.dir([...UIIssues.values()], { depth: null });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
