import "server-only";
import { APICallError, generateText } from "ai";
import type { Logger } from "pino";
import {
  selectModels,
  type ModelCandidate,
  type ProviderName,
} from "@/lib/ai/provider";
import { classifyFailure, type FailureReason } from "@/lib/review/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/log";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const PROBE_TIMEOUT_MS = 8_000;
const PROBE_MAX_OUTPUT_TOKENS = 16;
const PROBE_PROMPT = "ping";
const DEAD_MESSAGE = "provider dead";
const RECOVERED_MESSAGE = "provider recovered";

export type HealthState = "ok" | "dead" | "unknown";

export type ProviderHealth = {
  provider: ProviderName;
  modelId: string;
  state: HealthState;
  reason: FailureReason | null;
  checkedAt: string;
};

export type ProviderHealthReport = {
  status: HealthState | "mock";
  providers: ProviderHealth[];
};

type Verdict = Pick<ProviderHealth, "state" | "reason">;

type FailedProbe = { state: HealthState; reason: FailureReason };

type CacheEntry = { health: ProviderHealth; expiresAt: number };

const TTL_MS: Record<HealthState, number> = {
  ok: 6 * HOUR_MS,
  dead: 15 * MINUTE_MS,
  unknown: 10 * MINUTE_MS,
};

const STATE_BY_REASON: Record<FailureReason, HealthState> = {
  auth: "dead",
  unavailable: "dead",
  "rate-limit": "ok",
  "provider-limit": "ok",
  overloaded: "ok",
  server: "unknown",
  timeout: "unknown",
  "context-overflow": "unknown",
  "output-truncated": "unknown",
  "steps-exhausted": "unknown",
  "over-budget": "unknown",
  "key-rejected": "unknown",
  aborted: "unknown",
  unknown: "unknown",
};

export function healthStateFor(reason: FailureReason): HealthState {
  return STATE_BY_REASON[reason];
}

const healthLog = logger.child({ component: "provider-health" });
const cache = new Map<string, CacheEntry>();

let chain: ModelCandidate[] | null = null;
let inFlight: Promise<ProviderHealth[]> | null = null;

export async function checkProviderHealth(): Promise<ProviderHealthReport> {
  if (env.MOCK_REVIEW) return { status: "mock", providers: [] };

  inFlight ??= currentHealth().finally(() => {
    inFlight = null;
  });
  const providers = await inFlight;

  return { status: worstState(providers), providers };
}

export function recordProviderFailure(
  candidate: ModelCandidate,
  reason: FailureReason,
  error: unknown,
  log: Logger,
): void {
  if (env.MOCK_REVIEW || candidate.usesUserKey) return;
  if (healthStateFor(reason) !== "dead") return;

  logNewlyDead(log, candidate, { reason, err: error, source: "review" });
  remember(candidate, { state: "dead", reason });
}

function currentHealth(): Promise<ProviderHealth[]> {
  chain ??= selectModels(undefined, healthLog);

  return Promise.all(
    chain.map(async (candidate) => cached(candidate) ?? refreshed(candidate)),
  );
}

async function refreshed(candidate: ModelCandidate): Promise<ProviderHealth> {
  const verdict = await probe(candidate);

  if (verdict.state === "ok" && rememberedDead(candidate)) {
    healthLog.info(
      { provider: candidate.provider, modelId: candidate.modelId },
      RECOVERED_MESSAGE,
    );
  }
  return remember(candidate, verdict);
}

async function probe(candidate: ModelCandidate): Promise<Verdict> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), PROBE_TIMEOUT_MS);

  try {
    await Promise.race([
      generateText({
        model: candidate.model,
        prompt: PROBE_PROMPT,
        maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        abortSignal: timeout.signal,
      }),
      rejectOnAbort(timeout.signal),
    ]);
    return { state: "ok", reason: null };
  } catch (error) {
    const failed = failedProbe(error, timeout.signal.aborted);

    if (failed.state === "dead") {
      logNewlyDead(healthLog, candidate, {
        reason: failed.reason,
        err: error,
        source: "probe",
      });
    }
    return failed;
  } finally {
    clearTimeout(timer);
  }
}

function failedProbe(error: unknown, timedOut: boolean): FailedProbe {
  if (timedOut) return { state: healthStateFor("timeout"), reason: "timeout" };

  const reason = classifyFailure(error).reason;
  const state = healthStateFor(reason);

  return {
    state: state === "unknown" && isRefusal(error) ? "dead" : state,
    reason,
  };
}

function isRefusal(error: unknown): boolean {
  if (!APICallError.isInstance(error) || error.isRetryable) return false;

  const status = error.statusCode ?? 0;
  return status >= 400 && status < 500;
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

function cached(candidate: ModelCandidate): ProviderHealth | undefined {
  const entry = cache.get(cacheKey(candidate));
  return entry && Date.now() < entry.expiresAt ? entry.health : undefined;
}

function remember(candidate: ModelCandidate, verdict: Verdict): ProviderHealth {
  const now = Date.now();
  const health: ProviderHealth = {
    provider: candidate.provider,
    modelId: candidate.modelId,
    state: verdict.state,
    reason: verdict.reason,
    checkedAt: new Date(now).toISOString(),
  };

  cache.set(cacheKey(candidate), {
    health,
    expiresAt: now + TTL_MS[verdict.state],
  });
  return health;
}

function rememberedDead(candidate: ModelCandidate): boolean {
  return cache.get(cacheKey(candidate))?.health.state === "dead";
}

function cacheKey(candidate: ModelCandidate): string {
  return `${candidate.provider}:${candidate.modelId}`;
}

function worstState(providers: ProviderHealth[]): HealthState {
  const states = providers.map((health) => health.state);
  if (states.includes("dead")) return "dead";
  if (states.includes("unknown")) return "unknown";
  return "ok";
}

function logNewlyDead(
  log: Logger,
  candidate: ModelCandidate,
  details: { reason: FailureReason; err: unknown; source: "probe" | "review" },
): void {
  if (rememberedDead(candidate)) return;

  log.error(
    { provider: candidate.provider, modelId: candidate.modelId, ...details },
    DEAD_MESSAGE,
  );
}
