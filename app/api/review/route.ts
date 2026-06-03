import { streamText, stepCountIs } from "ai";
import { groq } from "@ai-sdk/groq";

import { parsePRUrl } from "@/lib/github/parse-url";
import { createGithubAccess } from "@/lib/github/octokit";
import { makeReviewTools } from "@/lib/ai/tools/review";
import { SYSTEM } from "@/lib/ai/system-prompt";
import { env } from "@/lib/env";
import { ModelIssue } from "@/lib/ai/schema/modelIssue";

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

  const tools = makeReviewTools(gh, head_sha, modelIssues);

  const messages = [
    {
      role: "user" as const,
      content: `Review this pull request: ${pr_url}`,
    },
  ];

  const result = streamText({
    model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
    system: SYSTEM,
    messages,
    tools,
    stopWhen: stepCountIs(60),
    abortSignal: req.signal,
    onFinish: () => {
      console.dir(modelIssues, { depth: null });
    },
  });

  return result.toUIMessageStreamResponse();
}
