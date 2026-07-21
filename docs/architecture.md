# Architecture and Conventions
## 1. Directory structure

- **`app/` — routing and UI only.** Pages, layouts, route handlers, client components and hooks. No domain or infrastructure logic lives here.
- **`lib/` — all domain and infrastructure logic.** The framework imposes structure only on `app/`; everything else we organize ourselves inside `lib/`.
- **The dependency graph is unidirectional:** `app → components → lib`. `lib/` never imports from `app/`.
- **Organization by domains and boundaries, not by technical layers.** No top-level `services/`, `controllers/`, `models/` folders. Instead: the dominant feature gets a single home, external services hide behind adapters, infrastructure is kept separate.
- **A domain entity has one home.** All states and logic of an entity live next to each other rather than being smeared across several technical folders.

Target skeleton (a folder-level reference, not a strict list):

```
app/            routing, UI, route handlers (thin)
lib/
  review/       the feature's single home: domain model, boundary schemas,
                stream contract, orchestration, tools, prompt
  ai/           LLM infrastructure (provider configuration)
  github/       external service adapter (port + implementation)
  env           environment validation
```

## 2. Boundaries and data translation

- **External boundaries speak their own language, the domain speaks its own.** Sources of external format: the GitHub API and the model-facing (LLM) schemas. Between them and the domain there is always a translation point.
- **Translation happens in the adapter, on entry into the domain.** An external module exposes data already in the domain format; the domain knows nothing about the shape of the external response.
- **`snake_case` is the language of boundaries, `camelCase` is the language of the domain and UI.**
- **The translation criterion:** a value is translated into the domain format if domain or UI logic consumes it; a value stays in the external format if it merely crosses the application from one external boundary to another (for example, data that is only shown to the model and takes no part in domain logic).
- **A type with multiple consumers.** If a value goes both to the domain/UI and to the model, it is stored in the internal format (`camelCase`) and handed to the LLM boundary as a snake_case projection. The format is not chosen "by the majority of fields" or "by the smaller diff": as soon as the UI or the domain consumes the data, the internal type becomes `camelCase` and the projection happens at the boundary.
- **The LLM contract deliberately stays in the external format.** Tool names and their input fields keep a shape that is familiar to the model and stable as an interface. This format is locked inside the tools-and-schemas layer and does not leak deeper into the domain.

## 3. Source of truth for types

- **Uncontrolled runtime input is validated by a schema; the type is inferred from the schema.** The type is not hand-written in parallel with the validation. This covers: incoming HTTP request bodies, data from the model, environment variables.
- **Internal domain structures are described by hand-written types.** If a structure is never parsed anywhere and exists only inside the application, it needs no schema.
- **Semi-trusted boundaries.** When an external source is accessed through a typed client library, trusting its types and narrowing without runtime validation is acceptable — provided the risk of divergence and the blast radius are small. Strict runtime validation is reserved for genuinely uncontrolled sources.
- **One entity — one type per state.** No empty aliases. If two formally different types are structurally identical, they are one type.

## 4. AI/LLM layer

- **Prompts, tool definitions and provider configuration are separate modules,** not inlined into a route or the orchestrator.
- **The model provider sits behind an abstraction.** Model and provider selection is concentrated in one place, which allows swapping them and supporting a fallback without edits across the codebase.
- **Tools are designed as an interface for the model:** semantic namespaced names, clear field names, error messages as actionable hints, an input schema.
- **The stream contract between backend and frontend has a single source** from which both sides are derived. The message type is not duplicated.
- **Proven mechanics are not rewritten.** If a streaming pattern is confirmed as canonical for the current stack, it stays; only file placement changes.

## 5. Orchestration and routes

- **Route handlers are thin:** validate the input, delegate to the domain orchestrator, return the result. Business logic, limits, provider or mock-mode selection live in the domain layer, not in the route.
- **Server-side logic is marked explicitly.** Modules that work with secrets and external clients are isolated behind a barrier that keeps server code from leaking into the client bundle.
- **Feature configuration is centralized.** Limits and thresholds live in one place instead of being scattered around the code as constants.

## 6. Configuration and environment

- **Everything that changes between deployments** (secrets, keys, hosts, flags) goes through environment variables, not code.
- **The environment is validated at startup** with a typed schema, fail-fast: a missing or invalid value crashes the app immediately with a clear error instead of failing later, mid-operation.
- **No external dependency is introduced for configuration** while a hand-written solution covers the need.
- **The per-IP rate limiter fails open.** If Redis is unavailable, or the check errors or times out, the request is allowed rather than blocked — availability of the review flow is deliberately prioritized over rate limiting during a Redis outage. The connection is awaited with a bounded timeout so a healthy-but-not-yet-connected Redis is used rather than bypassed for the first, sequential request; concurrent requests arriving during the brief sub-second cold-start connect window can still fail open before the first connection resolves — a bounded window that occurs at most once per process and is consistent with the deliberate fail-open, not a fully-eliminated bypass. Failures are logged rather than swallowed so the open state stays visible.
- **Database migrations run in the container entrypoint, serialized by a session-level advisory lock.** The entrypoint applies pending Drizzle migrations before it starts the server. To stop two replicas — or two overlapping zero-downtime deploys — from racing the same non-idempotent DDL (`CREATE TABLE "reviews"` has no `IF NOT EXISTS`), `migrate()` is wrapped in a blocking `pg_advisory_lock(MIGRATION_LOCK_KEY)` taken on the shared `max: 1` postgres-js connection: one physical connection means the session-level lock covers both the `__drizzle_migrations` read and the DDL, so `sql.reserve()` is unnecessary. The loser blocks until the winner releases, then re-reads the migration journal and applies nothing — idempotency comes for free. The key is a fixed integer constant, sent as an untyped parameter that resolves to the sole single-argument `pg_advisory_lock(bigint)` overload by arity. The trade-off is deliberate: migrate-in-entrypoint plus an advisory lock, rather than a one-shot pre-deploy migration job — it is simpler, lives entirely in the repository, and holds up under scale-out.
- **PID 1 in the container is `tini`, not the shell.** The entrypoint is `tini -g -- sh -c "node migrate.mjs && exec node … server.js"`, so `tini` reaps zombies and forwards signals to the child's entire process group (`-g`). Without it, during the migrate phase the intermediate `sh` is PID 1 and swallows `SIGTERM` — the `exec` that hands PID 1 to the server only happens on the second half — so a `docker stop` or redeploy mid-migration would hang until `SIGKILL`. Group-mode signalling reaches `node migrate.mjs` directly, so shutdown during a migration terminates cleanly instead.

## 7. Observability and security headers

- **Structured logs in the review flow go to stdout as JSON** through a single `pino` logger (`lib/log.ts`, behind the `server-only` barrier) — no transports, no pretty-printing, no extra env var. Errors are passed as raw objects at the call sites and sanitized centrally by a custom `err` serializer that wraps `pino`'s standard one: it strips the AI SDK's `requestBodyValues` (the full prompt — the private diff and file contents) and `responseBody` recursively (top level, the `aggregateErrors` array and any nested error/`cause` object) while keeping type, message, stack, status and the cause chain. Without this, a routine provider 429/529 during a private-PR failover would write the private code to stdout (which Coolify persists), breaking the "private reviews aren't persisted" guarantee. The Redis client and rate limiter still emit their own `console.error`, which writes flat `util.inspect` text (a multi-line stack) to stderr rather than JSON to stdout; folding them into `pino` is deferred with the rest of the observability polish. The Coolify container captures both stdout and stderr and owns aggregation.
- **Every review carries a `requestId`,** generated at the route boundary (honoring an incoming `X-Request-Id` header) and threaded as a `pino` child logger through the orchestrator and into the model tools, so a request's failover, DB-save and enrichment logs correlate under one id.
- **The previously silent failure sites now leave a trace:** a failed `saveReview` (the share link silently never appears), provider failover and final exhaustion, and an enrichment snippet that couldn't be built.
- **Uncaught server and render errors funnel through `onRequestError`** in the root `instrumentation.ts` — the single capture point that logs the error, its `digest` and the route context. It is guarded to the Node.js runtime so the `pino` import never reaches an edge bundle. The share-page client `error.tsx` surfaces that `digest` in its UI so a user can quote it and correlate their report with the server log.
- **Error-tracking (Sentry/GlitchTip) is deliberately deferred** behind the `onRequestError` seam: the choke point exists, the external dependency and DSN do not, until prod volume justifies them.
- **A nonce-based strict CSP is set per request in `proxy.ts`** (the Next 16 rename of `middleware.ts`), the industry-standard approach recommended by Next.js, OWASP and web.dev. Each request gets a fresh CSPRNG nonce; the nonce is put on the request so Next stamps it onto its own framework and bundle scripts, and the same `Content-Security-Policy` is set on the response. `script-src` is `'self' 'nonce-…' 'strict-dynamic'`: `'strict-dynamic'` discards host allowlists and trusts only the nonced bootstrap plus whatever it loads, so an injected `<script>` without the unguessable nonce cannot run. The app is already dynamic per request (mock/real reviews, DB-backed share pages), so the dynamic-rendering that nonces require costs us almost nothing — the root layout `await connection()`s, opting every route into per-request rendering so each gets a fresh nonce (a client-component page such as the home screen cannot host `connection()` itself, and `export const dynamic` is ignored there, so the shared layout is the single correct choke point).
- **`style-src` is `'self' 'unsafe-inline'` with no nonce, deliberately.** Shiki paints syntax tokens with inline `style="color:…"` attributes and the UI uses React `style={{}}`; a nonce cannot cover style *attributes*, and per spec a browser that sees both a nonce and `'unsafe-inline'` in `style-src` ignores `'unsafe-inline'`, which would silently break highlighting. Inline styles cannot execute code, so this is a low risk. `'wasm-unsafe-eval'` stays in `script-src` for Shiki's Oniguruma WASM; `'unsafe-eval'` is added only in development (React refresh/HMR needs it) and never ships to production.
- **Flat, static headers live in `next.config.ts` `headers()` on `/(.*)`** so they cover every response including static assets that the CSP matcher skips: `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` together forbid framing (clickjacking); `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; a `Permissions-Policy` that turns off clearly-unused features (camera, microphone, geolocation, payment, usb, motion sensors) while deliberately leaving clipboard alone because the copy button uses `navigator.clipboard.writeText`; and `Cross-Origin-Opener-Policy`/`Cross-Origin-Resource-Policy` set to `same-origin` (COEP is intentionally omitted — `require-corp` would break subresources).
- **HSTS is `max-age=63072000; includeSubDomains` without `preload`.** Preloading is near-irreversible (removal from the browser preload list takes months), so it is left off deliberately. If the edge (Traefik/Coolify) already emits HSTS, drop the app-level header to avoid a duplicate.
- **The private-PR gate returns 403 (not 404)** for an anonymous request against a private PR that the server `GITHUB_PAT` can read, which discloses the repository's existence to an anonymous prober. This is an accepted trade-off, not a fix left undone: the primary control is scoping `GITHUB_PAT` to `public_repo` (per `.env.example`), under which GitHub returns 404 for every private repo, the metadata fetch never surfaces a private PR, and this branch is never reached. Given that scoping, the 403-with-private-card response is kept deliberately for its clearer UX.

## 8. Naming

- **Files and folders** — `kebab-case`.
- **Types and interfaces** — `PascalCase`, no `I` prefix.
- **Fields** — `camelCase` in the domain and UI; `snake_case` only at external boundaries.
- **Components** — file in `kebab-case`, export in `PascalCase`. **Hooks** — `use` prefix.
- **Factories** — a single prefix (`create`).
- **Role suffixes in file names** (for example, for schemas) — selectively, only where the file's role is otherwise unclear. Co-location by default, without extracting types wholesale into separate files.
- **Constants** — `UPPER_SNAKE_CASE`. **Model tool names** — `snake_case`, namespaced.

## 9. What we deliberately don't do

Anti-overengineering for a project of the current size (one dominant feature):

- **No** `features/` or `src/` — an extra layer for a single-feature app.
- **No full hexagon / DDD** with use-case layers and behavior-rich domain classes: the entities have no invariants, this is data-in / data-out. Ports exist only for external services.
- **No centralized types folder** — co-location next to the code.
- **No barrel files** in client paths; they are acceptable only as the public entry point of a server-only module.
- **No abstractions or dependencies added in advance** — they are introduced when the simple solution is no longer enough.
