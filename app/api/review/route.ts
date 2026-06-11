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
import { ModelIssue } from "@/lib/ai/schema/modelIssue";

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

export async function POST(req: Request) {
  const { pr_url } = await req.json();

  const pr = parsePRUrl(pr_url);

  const gh = createGithubAccess(env.GITHUB_PAT, pr);

  const { head_sha, changed_files } = await gh.getPRMetadata();

  if (changed_files > 15) {
    return new Response(
      "Too many files changed. PR size must be less than 15 files.",
      { status: 400 }
    );
  }

  const modelIssues: ModelIssue[] = [];

  const messages = [
    {
      role: "user" as const,
      content: `Review this pull request: ${pr_url}`,
    },
  ];

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const tools = makeReviewTools(gh, head_sha, modelIssues, writer);

      const result = streamText({
        model: anthropic("claude-sonnet-4-6"),
        system: SYSTEM,
        messages,
        tools,
        stopWhen: stepCountIs(60),
        abortSignal: req.signal,
      });

      writer.merge(result.toUIMessageStream());
    },
    onFinish: () => {
      console.dir(modelIssues, { depth: null });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
