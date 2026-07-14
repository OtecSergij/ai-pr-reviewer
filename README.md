# AI PR Reviewer

An AI agent that reviews public GitHub pull requests: it walks the repository, reads the changed files in context through multi-step tool calling, and streams back a review with each issue linked to the exact lines on GitHub.

**Live demo:** https://reviewer.zablotsky.dev/

## What it does

- Paste a public PR URL — the agent fetches the PR, reads the diff and surrounding code via tool calls, and streams issues (error / warning / nit) incrementally as it finds them.
- Every issue links to the exact `file:line` range on GitHub, so you can verify it.
- Each completed review gets a shareable link (`/r/<slug>`) that renders the result.
- Premium mode: bring your own Anthropic key to run the review on Claude Sonnet.

## Stack

- **Next.js 16** (App Router) + **Vercel AI SDK v6** — the review streams to the browser over SSE.
- **Multiple model providers** (Cerebras / Groq / Gemini) with automatic fallback; premium path on Anthropic (BYO key).
- **PostgreSQL + Drizzle** — persisted share links, with an idempotent slug derived from the PR identity.
- **Redis** — per-IP rate limiting (sliding-window, multi-tier).
- **Self-hosted** on a VPS via Coolify + Traefik: the image is built in CI, pushed to GHCR, and auto-deployed on push to `main`; the long-running review stream passes through the proxy incrementally.

## Local development

Requires a local PostgreSQL and Redis.

```bash
cp .env.example .env.local   # provider keys, GITHUB_PAT, DATABASE_URL, REDIS_URL
npm install
npm run db:migrate           # apply Drizzle migrations
npm run dev
```

Open http://localhost:3000.
