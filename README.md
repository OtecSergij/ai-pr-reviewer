# AI PR Reviewer

An AI agent that reviews GitHub pull requests: it walks the repository, reads the changed files in context through multi-step tool calling, and streams back a review with each issue linked to the exact lines on GitHub.

**Live demo:** https://reviewer.zablotsky.dev/

## What it does

- Paste a PR URL — the agent fetches the PR, reads the diff and surrounding code via tool calls, and streams issues (error / warning / nit / suggestion) incrementally as it finds them.
- Every issue links to the exact `file:line` range on GitHub, so you can verify it.
- Each completed public review gets a shareable link (`/r/<slug>`) that renders the result.
- Private mode: bring your own GitHub token (`repo` scope) to review a private PR — the token is used in-memory for that single request and never stored. Private reviews aren't persisted and get no share link.
- Premium mode: bring your own Anthropic key to run the review on Claude Sonnet.

## Stack

- **Next.js 16** (App Router) + **Vercel AI SDK v6** — the review streams to the browser over SSE.
- **Multiple model providers** (Cerebras / Groq / Gemini) with automatic fallback; premium path on Anthropic (BYO key).
- **PostgreSQL + Drizzle** — persisted share links, with an idempotent slug derived from the PR identity.
- **Redis** — per-IP rate limiting (sliding-window, multi-tier); behind the proxy the deployment sets `TRUST_PROXY=1` so the limiter reads the real client IP instead of counting every visitor in one bucket.
- **Self-hosted** on a VPS via Coolify + Traefik: the image is built in CI, pushed to GHCR, and auto-deployed on push to `main`; the long-running review stream passes through the proxy incrementally.

## Known limits

- PRs with more than 15 changed files are rejected up front.
- Reviews are rate-limited per IP; the budgets live in `lib/rate-limit.ts`. If Redis is unreachable, an equivalent in-memory sliding window takes over, so the same budgets still hold.
- Oversized inputs are cut honestly rather than silently: large patches are truncated at a hunk boundary, oversized files are refused, and the model is told about both. Files that look machine-generated (build output, lockfiles, minified bundles) are flagged so the agent skips them.
- A run that exhausts a free model's output limit is handed to the next provider in the chain; if the last one is also cut short, the review ends as "Review cut short" and is not saved — only reviews that ran to completion get a share link. Bringing your own Anthropic key usually covers more.
- The agent runs under a hard step ceiling to bound cost and latency.

## Local development

Requires a local PostgreSQL and Redis.

```bash
cp .env.example .env.local   # provider keys, GITHUB_PAT, DATABASE_URL, REDIS_URL
npm install
npm run db:migrate           # apply Drizzle migrations
npm run dev
```

Open http://localhost:3000.

Startup validates the env and fails fast while anything is missing: real reviews need the provider keys and `GITHUB_PAT` filled in (plus Postgres and Redis). To boot without any keys, use the keyless demo below.
