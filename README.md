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
- **Multiple model providers** (Groq / Cerebras / Gemini) with automatic fallback; premium path on Anthropic (BYO key).
- **PostgreSQL + Drizzle** — persisted share links, with an idempotent slug derived from the PR identity.
- **Redis** — per-IP rate limiting (sliding-window, multi-tier); behind the proxy the deployment sets `TRUST_PROXY=1` so the limiter reads the real client IP instead of counting every visitor in one bucket.
- **Self-hosted** on a VPS via Coolify + Traefik: the image is built in CI, pushed to GHCR, and auto-deployed on push to `main`; the long-running review stream passes through the proxy incrementally.

## Known limits

- PRs with more than 15 reviewable changed files are rejected up front; generated files (build output, lockfiles, minified bundles) do not count against that limit.
- Reviews are rate-limited per IP; the budgets live in `lib/rate-limit.ts`. The review slot is taken before the run starts and is never refunded, so a review that fails — or a PR refused as private or oversized — still costs one; the URL is parsed before that slot, so a typo doesn't burn it.
- Oversized inputs are paginated or refused honestly rather than cut silently: a large patch is served in parts split at hunk boundaries, and the agent asks for the next part when it needs one — with a budget per file and per review, so a file read only in part is marked as such in the sidebar. Oversized files are refused with a pointer back to the diff. Files that look machine-generated (build output, lockfiles, minified bundles) are flagged so the agent skips them.
- A run that exhausts a free model's output limit is handed to the next provider in the chain; if the last one is also cut short, the review ends as "Review cut short" and is not saved — only reviews that ran to completion get a share link. Bringing your own Anthropic key usually covers more.
- The free chain runs under a hard step ceiling to bound cost and latency. A review on your own Anthropic key runs without one — your key, your budget.

## Local development

Requires Node 26 (see `.nvmrc`), plus local PostgreSQL and Redis.

```bash
cp .env.example .env.local   # provider keys, GITHUB_PAT, DATABASE_URL, REDIS_URL
npm install
npm run db:migrate           # apply Drizzle migrations
npm run dev
```

Open http://localhost:3000.

Startup validates the env and fails fast while anything is missing: real reviews need the provider keys and `GITHUB_PAT` filled in (plus Postgres and Redis). To boot with no keys at all, set `MOCK_REVIEW=1` — with the rest of the `MOCK_*` variables documented in `.env.example`, it streams a fixture review instead of calling a model.

## Self-hosting

The image that CI publishes to GHCR on every push to `main` is the whole deployment — it needs an env file and a port:

```bash
docker run --env-file .env.local -p 3000:3000 ghcr.io/otecsergij/ai-pr-reviewer:latest
```

The entrypoint applies the migrations and then starts the server, so the image needs nothing besides that file — every variable it reads is annotated in `.env.example`. One caveat: `DATABASE_URL` and `REDIS_URL` have to resolve from inside the container, so a `localhost` carried over from local development points at the container itself. Either join their docker network (`--network`, with the Postgres and Redis container names as the hostnames) or use `host.docker.internal` — which on Linux also takes `--add-host=host.docker.internal:host-gateway`.

Production is redeployed by a Coolify webhook that CI calls with two repo secrets, `COOLIFY_DEPLOY_URL` and `COOLIFY_TOKEN`; a fork without them skips the deploy step instead of failing it.
