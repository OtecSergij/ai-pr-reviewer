import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { APICallError } from "ai";
import { isTtfbTimeout, tracedFetch, ttfbTimeoutError } from "./provider-fetch";

const log = pino({ level: "silent" });
const URL_UNDER_TEST = "https://api.groq.com/openai/v1/chat/completions";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
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

    await expect(tracedFetch("cerebras", log)(URL_UNDER_TEST)).rejects.toBe(
      boom,
    );
  });
});
