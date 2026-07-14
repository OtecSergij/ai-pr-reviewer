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

## 7. Naming

- **Files and folders** — `kebab-case`.
- **Types and interfaces** — `PascalCase`, no `I` prefix.
- **Fields** — `camelCase` in the domain and UI; `snake_case` only at external boundaries.
- **Components** — file in `kebab-case`, export in `PascalCase`. **Hooks** — `use` prefix.
- **Factories** — a single prefix (`create`).
- **Role suffixes in file names** (for example, for schemas) — selectively, only where the file's role is otherwise unclear. Co-location by default, without extracting types wholesale into separate files.
- **Constants** — `UPPER_SNAKE_CASE`. **Model tool names** — `snake_case`, namespaced.

## 8. What we deliberately don't do

Anti-overengineering for a project of the current size (one dominant feature):

- **No** `features/` or `src/` — an extra layer for a single-feature app.
- **No full hexagon / DDD** with use-case layers and behavior-rich domain classes: the entities have no invariants, this is data-in / data-out. Ports exist only for external services.
- **No centralized types folder** — co-location next to the code.
- **No barrel files** in client paths; they are acceptable only as the public entry point of a server-only module.
- **No abstractions or dependencies added in advance** — they are introduced when the simple solution is no longer enough.
