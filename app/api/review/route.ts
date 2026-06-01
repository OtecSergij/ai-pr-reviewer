import { streamText, stepCountIs } from "ai";
import { groq } from "@ai-sdk/groq";

import { parsePRUrl } from "@/lib/github/parse-url";
import { createGithubAccess } from "@/lib/github/octokit";
import { makeReviewTools } from "@/lib/ai/tools/review";
import { SYSTEM } from "@/lib/ai/system-prompt";
import { env } from "@/lib/env";

export async function POST(req: Request) {
  const { pr_url } = await req.json();

  const pr = parsePRUrl(pr_url);

  const gh = createGithubAccess(env.GITHUB_PAT, pr);

  const { head_sha, changed_files } = await gh.getPRMetadata();

  if (changed_files > 50) {
    return new Response(
      "Too many files changed. PR size must be less than 50 files.",
      { status: 400 }
    );
  }

  const tools = makeReviewTools(gh, head_sha);

  const messages = [
    {
      role: "user" as const,
      content: `Review this pull request: ${pr_url}`,
    },
  ];

  const result = streamText({
    model: groq("llama-3.3-70b-versatile"),
    system: SYSTEM,
    messages,
    tools,
    stopWhen: stepCountIs(30),
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse();
}
