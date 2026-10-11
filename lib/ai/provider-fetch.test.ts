import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { APICallError } from "ai";
import {
  RATE_LIMIT_RESET_MARGIN_MS,
  RATE_LIMIT_WAITS,
  RATE_LIMIT_WAIT_CEILING_MS,
  isTtfbTimeout,
  tracedFetch,
  ttfbTimeoutError,
  waitingOutRateLimit,
} from "./provider-fetch";

const log = pino({ level: "silent" });
const URL_UNDER_TEST = "https://api.groq.com/openai/v1/chat/completions";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function stubFetch(impl: typeof fetch): void {
  globalThis.fetch = impl;
}

function collectingLogger() {
  const records: Record<string, unknown>[] = [];
  return {
    records,
    logger: pino(
      { level: "info" },
      {
        write(line: string) {
          records.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    ),
  };
}

describe("the synthetic TTFB error", () => {
  it("is a non-retryable APICallError, so the SDK swipes instead of sleeping", () => {
    const err = ttfbTimeoutError(URL_UNDER_TEST);
    expect(APICallError.isInstance(err)).toBe(true);
    expect(err.isRetryable).toBe(false);
    expect(err.statusCode).toBe(504);
  });

  it("is recognized by its marker, not by the status alone", () => {
    expect(isTtfbTimeout(ttfbTimeoutError(URL_UNDER_TEST))).toBe(true);
    expect(
      isTtfbTimeout(
        new APICallError({
          message: "gateway timeout",
          url: URL_UNDER_TEST,
          requestBodyValues: {},
          statusCode: 504,
        }),
      ),
    ).toBe(false);
  });

  it("carries no request body into the logs", () => {
    expect(ttfbTimeoutError(URL_UNDER_TEST).requestBodyValues).toBeUndefined();
  });
});

describe("tracedFetch on a response", () => {
  it("returns it untouched and logs the attempt with its retry-after", async () => {
    const { records, logger } = collectingLogger();
    stubFetch(
      async () =>
        new Response("{}", {
          status: 429,
          headers: { "retry-after": "58" },
        }),
    );

    const response = await tracedFetch("groq", logger)(URL_UNDER_TEST);
    expect(response.status).toBe(429);

    const attempt = records.find((r) => r.msg === "provider request");
    expect(attempt).toMatchObject({
      provider: "groq",
      host: "api.groq.com",
      status: 429,
      retryAfter: "58",
    });
    expect(typeof attempt?.durationMs).toBe("number");
  });
});

describe("tracedFetch on a stalled provider", () => {
  it("gives up at the TTFB budget with the synthetic error", async () => {
    stubFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );

    await expect(
      tracedFetch("google", log, 20)(URL_UNDER_TEST),
    ).rejects.toSatisfy(
      (e) => APICallError.isInstance(e) && isTtfbTimeout(e) && !e.isRetryable,
    );
  });

  it("stops timing once the headers are in, so a slow body is not cut off", async () => {
    stubFetch(async () => new Response("{}", { status: 200 }));

    const response = await tracedFetch("google", log, 20)(URL_UNDER_TEST);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("{}");
  });
});

describe("tracedFetch when the user pressed Stop", () => {
  it("rethrows the original abort rather than dressing it as a timeout", async () => {
    const user = new AbortController();
    stubFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );

    const pending = tracedFetch(
      "groq",
      log,
      5_000,
    )(URL_UNDER_TEST, {
      signal: user.signal,
    });
    user.abort();

    await expect(pending).rejects.toSatisfy(
      (e) => e instanceof DOMException && e.name === "AbortError",
    );
  });

  it("keeps the abort branch even when the TTFB budget expires in the same tick", async () => {
    const user = new AbortController();
    stubFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
          user.abort();
        }),
    );

    await expect(
      tracedFetch("groq", log, 0)(URL_UNDER_TEST, { signal: user.signal }),
    ).rejects.toSatisfy((e) => !APICallError.isInstance(e));
  });
});

describe("tracedFetch on a transport failure", () => {
  it("passes the original error through untouched", async () => {
    const boom = new TypeError("fetch failed");
    stubFetch(async () => {
      throw boom;
    });

    await expect(tracedFetch("openrouter", log)(URL_UNDER_TEST)).rejects.toBe(
      boom,
    );
  });
});

describe("waitingOutRateLimit", () => {
  const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
  const NOW = Date.parse("2026-10-04T12:00:20.000Z");
  const WINDOW_RESET = Date.parse("2026-10-04T12:01:00.000Z");
  const UNTIL_RESET_MS = WINDOW_RESET - NOW;

  const rateLimited = (resetAt?: number): Response =>
    new Response('{"error":{"code":429}}', {
      status: 429,
      headers:
        resetAt === undefined ? {} : { "x-ratelimit-reset": String(resetAt) },
    });

  const answered = (): Response => new Response("{}", { status: 200 });

  const frozenClock = (): void => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  };

  it("waits for the per-minute window to reset, then asks again", async () => {
    frozenClock();
    const inner = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rateLimited(WINDOW_RESET))
      .mockResolvedValueOnce(answered());

    const pending = waitingOutRateLimit(
      "openrouter",
      log,
      inner,
    )(OPENROUTER_URL);

    await vi.advanceTimersByTimeAsync(
      UNTIL_RESET_MS + RATE_LIMIT_RESET_MARGIN_MS - 1,
    );
    expect(inner).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("says in the log how long it is waiting", async () => {
    frozenClock();
    const { records, logger } = collectingLogger();
    const inner = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rateLimited(WINDOW_RESET))
      .mockResolvedValueOnce(answered());

    const pending = waitingOutRateLimit(
      "openrouter",
      logger,
      inner,
    )(OPENROUTER_URL);
    await vi.runAllTimersAsync();
    await pending;

    expect(records).toMatchObject([
      {
        level: 40,
        provider: "openrouter",
        waitMs: UNTIL_RESET_MS + RATE_LIMIT_RESET_MARGIN_MS,
        msg: "provider rate limited, waiting for the window to reset",
      },
    ]);
  });

  it("hands back a refusal whose window resets too far away to wait for", async () => {
    frozenClock();
    const dailyLimit = rateLimited(NOW + RATE_LIMIT_WAIT_CEILING_MS);
    const inner = vi.fn<typeof fetch>().mockResolvedValue(dailyLimit);

    await expect(
      waitingOutRateLimit("openrouter", log, inner)(OPENROUTER_URL),
    ).resolves.toBe(dailyLimit);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("hands back a refusal that names no reset", async () => {
    const refusal = rateLimited();
    const inner = vi.fn<typeof fetch>().mockResolvedValue(refusal);

    await expect(
      waitingOutRateLimit("openrouter", log, inner)(OPENROUTER_URL),
    ).resolves.toBe(refusal);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("stops waiting once it has waited the allowed number of times", async () => {
    frozenClock();
    const inner = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => rateLimited(Date.now() + 30_000));

    const pending = waitingOutRateLimit(
      "openrouter",
      log,
      inner,
    )(OPENROUTER_URL);
    await vi.runAllTimersAsync();

    expect((await pending).status).toBe(429);
    expect(inner).toHaveBeenCalledTimes(RATE_LIMIT_WAITS + 1);
  });

  it("gives the wait up as soon as the request is aborted", async () => {
    frozenClock();
    const controller = new AbortController();
    const inner = vi
      .fn<typeof fetch>()
      .mockResolvedValue(rateLimited(WINDOW_RESET));

    const pending = waitingOutRateLimit(
      "openrouter",
      log,
      inner,
    )(OPENROUTER_URL, { signal: controller.signal });
    const outcome = expect(pending).rejects.toBe("walked away");

    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort("walked away");

    await outcome;
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("passes every other answer through untouched", async () => {
    const serverError = new Response("{}", {
      status: 503,
      headers: { "x-ratelimit-reset": String(Date.now() + 30_000) },
    });
    const inner = vi.fn<typeof fetch>().mockResolvedValue(serverError);

    await expect(
      waitingOutRateLimit("openrouter", log, inner)(OPENROUTER_URL),
    ).resolves.toBe(serverError);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
