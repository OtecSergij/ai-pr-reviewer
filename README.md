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

By default reviews are real — they need the provider keys and `GITHUB_PAT` above (plus Postgres and Redis).

### Keyless demo

To run a demo without any keys, set `MOCK_REVIEW=1` in `.env.local` and paste `https://github.com/vercel/ms/pull/35` into the form: the app streams a fixture review without ever calling the LLM (it only needs network access to github.com for that public PR). Optionally set `MOCK_ERROR=<value>` to exercise the UI's error states — see `.env.example` for the allowed values.
