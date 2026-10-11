import { APICallError } from "ai";
import type { Logger } from "pino";
import type { ProviderName } from "@/lib/ai/provider";

export const TTFB_TIMEOUT_MS = 20_000;

export const RATE_LIMIT_WAIT_CEILING_MS = 65_000;
export const RATE_LIMIT_RESET_MARGIN_MS = 1_000;
export const RATE_LIMIT_WAITS = 2;

const TTFB_TIMEOUT_STATUS = 504;
const TTFB_TIMEOUT_MARKER = "pr-reviewer/ttfb-timeout";

export function ttfbTimeoutError(url: string): APICallError {
  return new APICallError({
    message: `${TTFB_TIMEOUT_MARKER}: no response headers within ${TTFB_TIMEOUT_MS}ms`,
    url,
    requestBodyValues: undefined,
    statusCode: TTFB_TIMEOUT_STATUS,
    isRetryable: false,
  });
}

export function isTtfbTimeout(error: APICallError): boolean {
  return (
    error.statusCode === TTFB_TIMEOUT_STATUS &&
    error.message.startsWith(TTFB_TIMEOUT_MARKER)
  );
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function tracedFetch(
  provider: ProviderName,
  log: Logger,
  timeoutMs: number = TTFB_TIMEOUT_MS,
): typeof fetch {
  return async (input, init) => {
    const url = urlOf(input);
    const host = URL.parse(url)?.host ?? "unknown";
    const startedAt = Date.now();
    const external = init?.signal ?? null;
    const ttfb = new AbortController();
    const timer = setTimeout(() => ttfb.abort(), timeoutMs);
    const signal = external
      ? AbortSignal.any([external, ttfb.signal])
      : ttfb.signal;

    try {
      const response = await fetch(input, { ...init, signal });

      log.info(
        {
          provider,
          host,
          status: response.status,
          retryAfter: response.headers.get("retry-after"),
          durationMs: Date.now() - startedAt,
        },
        "provider request",
      );

      return response;
    } catch (e) {
      const durationMs = Date.now() - startedAt;

      if (ttfb.signal.aborted && external?.aborted !== true) {
        log.warn(
          { provider, host, durationMs, ttfbTimeoutMs: timeoutMs },
          "provider request timed out before response headers",
        );
        throw ttfbTimeoutError(url);
      }

      log.warn(
        { err: e, provider, host, durationMs },
        "provider request failed",
      );
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
}

function msUntilReset(response: Response): number | undefined {
  if (response.status !== 429) return undefined;

  const resetAt = Number(response.headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(resetAt) || resetAt <= 0) return undefined;

  const waitMs = resetAt - Date.now() + RATE_LIMIT_RESET_MARGIN_MS;
  return waitMs > 0 && waitMs <= RATE_LIMIT_WAIT_CEILING_MS
    ? waitMs
    : undefined;
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function waitingOutRateLimit(
  provider: ProviderName,
  log: Logger,
  inner: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    for (let waits = 0; ; waits += 1) {
      const response = await inner(input, init);
      const waitMs =
        waits < RATE_LIMIT_WAITS ? msUntilReset(response) : undefined;

      if (waitMs === undefined) return response;

      log.warn(
        { provider, waitMs },
        "provider rate limited, waiting for the window to reset",
      );
      await response.body?.cancel();
      await sleep(waitMs, init?.signal);
    }
  };
}
