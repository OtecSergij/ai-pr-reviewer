import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { Logger } from "pino";
import type { ModelCandidate, ProviderName } from "@/lib/ai/provider";
import { ttfbTimeoutError } from "@/lib/ai/provider-fetch";
import type { HealthState } from "@/lib/ai/provider-health";
import type { FailureReason } from "@/lib/review/errors";

type ProviderHealthModule = typeof import("@/lib/ai/provider-health");

type LogRecord = {
  level: string;
  data: Record<string, unknown>;
  msg: string;
};

type ProbeOptions = Parameters<MockLanguageModelV3["doGenerate"]>[0];

type Answer = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;

type Provider = (options: ProbeOptions) => Promise<Answer>;

const { envMock, logRecords, selectModelsMock } = vi.hoisted(() => ({
  envMock: { MOCK_REVIEW: false },
  logRecords: [] as LogRecord[],
  selectModelsMock: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: envMock }));

vi.mock("@/lib/ai/provider", () => ({ selectModels: selectModelsMock }));

vi.mock("@/lib/log", () => {
  const record =
    (level: string) =>
    (data: unknown, msg?: string): void => {
      logRecords.push(
        typeof data === "string"
          ? { level, data: {}, msg: data }
          : {
              level,
              data: (data ?? {}) as Record<string, unknown>,
              msg: msg ?? "",
            },
      );
    };

  const make = (): Record<string, unknown> => ({
    child: () => make(),
    trace: record("trace"),
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    fatal: record("fatal"),
  });

  return { logger: make() };
});

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const CHECKED_AT_START = "2026-10-03T12:00:00.000Z";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const OK_TTL_MS = 6 * HOUR_MS;
const DEAD_TTL_MS = 15 * MINUTE_MS;
const UNKNOWN_TTL_MS = 10 * MINUTE_MS;
const PROBE_TIMEOUT_MS = 8_000;
const DEAD_MESSAGE = "provider dead";
const RECOVERED_MESSAGE = "provider recovered";
const SERVER_KEY = "gsk_live_0123456789abcdef";

const EXPECTED_STATE: Record<FailureReason, HealthState> = {
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

const groq = vi.fn<Provider>();
const cerebras = vi.fn<Provider>();
const google = vi.fn<Provider>();
const providers = [groq, cerebras, google];

const candidate = (
  provider: ProviderName,
  modelId: string,
  doGenerate: Provider,
  usesUserKey = false,
): ModelCandidate => ({
  model: new MockLanguageModelV3({ provider, modelId, doGenerate }),
  provider,
  modelId,
  usesUserKey,
  contextWindow: 131_072,
  tpmBudget: 8_000,
});

const GROQ = candidate("groq", "openai/gpt-oss-120b", groq);
const CEREBRAS = candidate("cerebras", "gpt-oss-120b", cerebras);
const GOOGLE = candidate("google", "gemini-2.5-flash", google);

const answered = (finish: "stop" | "length" = "stop"): Answer => ({
  content:
    finish === "stop"
      ? [{ type: "text", text: "pong" }]
      : [{ type: "reasoning", text: "The user says ping. We should" }],
  finishReason: { unified: finish, raw: finish },
  usage: {
    inputTokens: {
      total: 8,
      noCache: 8,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 16, text: undefined, reasoning: undefined },
  },
  warnings: [],
});

const apiError = (
  statusCode: number,
  options: {
    isRetryable?: boolean;
    message?: string;
    responseBody?: string;
  } = {},
): APICallError =>
  new APICallError({
    message: options.message ?? "api error",
    url: "https://provider.example/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: options.responseBody,
    isRetryable: options.isRetryable,
  });

const stalled: Provider = ({ abortSignal }) =>
  new Promise((_resolve, reject) => {
    abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
  });

const deafToAbort: Provider = () => new Promise(() => {});

const loadHealth = async (): Promise<ProviderHealthModule> => {
  vi.resetModules();
  return import("@/lib/ai/provider-health");
};

const reviewLogger = (): { log: Logger; errors: unknown[][] } => {
  const errors: unknown[][] = [];
  const log = {
    error: (...args: unknown[]) => errors.push(args),
  } as unknown as Logger;
  return { log, errors };
};

const deadLogs = (): LogRecord[] =>
  logRecords.filter((entry) => entry.msg === DEAD_MESSAGE);

const recoveredLogs = (): LogRecord[] =>
  logRecords.filter((entry) => entry.msg === RECOVERED_MESSAGE);

const probeCounts = (): number[] =>
  providers.map((provider) => provider.mock.calls.length);

beforeEach(() => {
  envMock.MOCK_REVIEW = false;
  logRecords.length = 0;
  selectModelsMock.mockReset();
  selectModelsMock.mockReturnValue([GROQ, CEREBRAS, GOOGLE]);
  for (const provider of providers) {
    provider.mockReset();
    provider.mockImplementation(async () => answered());
  }
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("healthStateFor", () => {
  it.each(Object.entries(EXPECTED_STATE))(
    "reads %s as %s",
    async (reason, state) => {
      const { healthStateFor } = await loadHealth();

      expect(healthStateFor(reason as FailureReason)).toBe(state);
    },
  );
});

describe("a probe round over a chain that answers", () => {
  it("reports every candidate ok, in chain order", async () => {
    const { checkProviderHealth } = await loadHealth();

    await expect(checkProviderHealth()).resolves.toEqual({
      status: "ok",
      providers: [
        {
          provider: "groq",
          modelId: "openai/gpt-oss-120b",
          state: "ok",
          reason: null,
          checkedAt: CHECKED_AT_START,
        },
        {
          provider: "cerebras",
          modelId: "gpt-oss-120b",
          state: "ok",
          reason: null,
          checkedAt: CHECKED_AT_START,
        },
        {
          provider: "google",
          modelId: "gemini-2.5-flash",
          state: "ok",
          reason: null,
          checkedAt: CHECKED_AT_START,
        },
      ],
    });
  });

  it("walks the server-key chain, not a caller's own key", async () => {
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    expect(selectModelsMock).toHaveBeenCalledTimes(1);
    expect(selectModelsMock.mock.calls[0][0]).toBeUndefined();
  });

  it("spends one tiny request on each candidate", async () => {
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    for (const provider of providers) {
      expect(provider).toHaveBeenCalledTimes(1);
      expect(provider.mock.calls[0][0]).toMatchObject({
        maxOutputTokens: 16,
        prompt: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      });
    }
  });

  it("counts a reasoning model cut off before any text as answered", async () => {
    groq.mockImplementation(async () => answered("length"));
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(report.providers[0]).toMatchObject({ state: "ok", reason: null });
  });

  it("logs nothing of its own", async () => {
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    expect(logRecords).toEqual([]);
  });
});

describe("a probe a provider refuses", () => {
  it.each([401, 402, 403])("reads a %i as a dead key", async (status) => {
    cerebras.mockRejectedValue(apiError(status));
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(report.status).toBe("dead");
    expect(report.providers.map((health) => health.state)).toEqual([
      "ok",
      "dead",
      "ok",
    ]);
    expect(report.providers[1].reason).toBe("auth");
  });

  it("reads a 404 as a dead model", async () => {
    google.mockRejectedValue(apiError(404));
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(report.status).toBe("dead");
    expect(report.providers[2]).toMatchObject({
      state: "dead",
      reason: "unavailable",
    });
  });

  it("logs each dead candidate at error with the failure that proved it", async () => {
    const paymentRequired = apiError(402);
    const permissionDenied = apiError(403);
    cerebras.mockRejectedValue(paymentRequired);
    google.mockRejectedValue(permissionDenied);
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    expect(deadLogs()).toEqual([
      {
        level: "error",
        msg: DEAD_MESSAGE,
        data: {
          provider: "cerebras",
          modelId: "gpt-oss-120b",
          reason: "auth",
          err: paymentRequired,
          source: "probe",
        },
      },
      {
        level: "error",
        msg: DEAD_MESSAGE,
        data: {
          provider: "google",
          modelId: "gemini-2.5-flash",
          reason: "auth",
          err: permissionDenied,
          source: "probe",
        },
      },
    ]);
  });

  it("keeps the provider's words and the key out of the report", async () => {
    groq.mockRejectedValue(
      apiError(401, {
        message: `Invalid API Key ${SERVER_KEY}`,
        responseBody: `{"error":{"message":"Invalid API Key ${SERVER_KEY}","code":"invalid_api_key"}}`,
      }),
    );
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();
    const body = JSON.stringify(report);

    expect(Object.keys(report.providers[0])).toEqual([
      "provider",
      "modelId",
      "state",
      "reason",
      "checkedAt",
    ]);
    expect(body).not.toContain(SERVER_KEY);
    expect(body).not.toMatch(/invalid/i);
  });
});

describe("a probe a provider throttles", () => {
  it.each([
    [429, "rate-limit"],
    [413, "provider-limit"],
    [529, "overloaded"],
  ])("reads a %i as a key that works", async (status, reason) => {
    groq.mockRejectedValue(apiError(status));
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(report.status).toBe("ok");
    expect(report.providers[0]).toMatchObject({ state: "ok", reason });
    expect(deadLogs()).toEqual([]);
  });

  it("keeps a 413 a working key, non-retryable 4xx though it is", async () => {
    const tooLarge = apiError(413);
    groq.mockRejectedValue(tooLarge);
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(tooLarge.isRetryable).toBe(false);
    expect(report.providers[0]).toMatchObject({
      state: "ok",
      reason: "provider-limit",
    });
  });
});

describe("a probe refused with a status the classifier cannot name", () => {
  it.each([400, 422])(
    "reads a %i as dead and keeps the classifier's reason",
    async (status) => {
      groq.mockRejectedValue(apiError(status));
      const { checkProviderHealth } = await loadHealth();
      const report = await checkProviderHealth();

      expect(report.status).toBe("dead");
      expect(report.providers[0]).toMatchObject({
        state: "dead",
        reason: "unknown",
      });
    },
  );

  it("logs it like any other dead probe", async () => {
    const badRequest = apiError(400);
    groq.mockRejectedValue(badRequest);
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    expect(deadLogs()).toEqual([
      {
        level: "error",
        msg: DEAD_MESSAGE,
        data: {
          provider: "groq",
          modelId: "openai/gpt-oss-120b",
          reason: "unknown",
          err: badRequest,
          source: "probe",
        },
      },
    ]);
  });

  it("reads a 400 the classifier calls a context overflow as dead too", async () => {
    groq.mockRejectedValue(
      apiError(400, { responseBody: "prompt is too long: 9 tokens > 8" }),
    );
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(report.providers[0]).toMatchObject({
      state: "dead",
      reason: "context-overflow",
    });
  });

  it.each([408, 409])("leaves a retryable %i undecided", async (status) => {
    const retryable = apiError(status);
    groq.mockRejectedValue(retryable);
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(retryable.isRetryable).toBe(true);
    expect(report.providers[0]).toMatchObject({
      state: "unknown",
      reason: "server",
    });
  });

  it("leaves a 400 the provider itself marked retryable undecided", async () => {
    groq.mockRejectedValue(apiError(400, { isRetryable: true }));
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(report.providers[0]).toMatchObject({
      state: "unknown",
      reason: "server",
    });
  });

  it("leaves a non-retryable 5xx undecided", async () => {
    groq.mockRejectedValue(apiError(501, { isRetryable: false }));
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(report.providers[0]).toMatchObject({
      state: "unknown",
      reason: "unknown",
    });
  });

  it("leaves a 200 the SDK could not read undecided", async () => {
    groq.mockRejectedValue(apiError(200, { message: "Invalid JSON response" }));
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(report.providers[0]).toMatchObject({
      state: "unknown",
      reason: "unknown",
    });
  });

  it("leaves the fetch layer's own 504 undecided, non-retryable as it is", async () => {
    groq.mockRejectedValue(
      ttfbTimeoutError("https://api.groq.com/openai/v1/chat/completions"),
    );
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(report.providers[0]).toMatchObject({
      state: "unknown",
      reason: "timeout",
    });
    expect(deadLogs()).toEqual([]);
  });
});

describe("a probe that proves nothing", () => {
  it("leaves a 5xx undecided and does not retry it", async () => {
    groq.mockRejectedValue(apiError(503, { isRetryable: true }));
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(report.status).toBe("unknown");
    expect(report.providers[0]).toMatchObject({
      state: "unknown",
      reason: "server",
    });
    expect(groq).toHaveBeenCalledTimes(1);
  });

  it("leaves a network failure undecided", async () => {
    groq.mockRejectedValue(new TypeError("fetch failed"));
    const { checkProviderHealth } = await loadHealth();
    const report = await checkProviderHealth();

    expect(report.providers[0]).toMatchObject({
      state: "unknown",
      reason: "unknown",
    });
  });

  it("gives up on a silent provider at the probe timeout and aborts the request", async () => {
    groq.mockImplementation(stalled);
    const { checkProviderHealth } = await loadHealth();

    const pending = checkProviderHealth();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
    expect(groq.mock.calls[0][0].abortSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const report = await pending;

    expect(groq.mock.calls[0][0].abortSignal?.aborted).toBe(true);
    expect(report.providers[0]).toMatchObject({
      state: "unknown",
      reason: "timeout",
    });
  });

  it("gives up at the same deadline on a provider that ignores the abort", async () => {
    groq.mockImplementation(deafToAbort);
    const { checkProviderHealth } = await loadHealth();

    const pending = checkProviderHealth();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({
      status: "unknown",
      providers: [{ state: "unknown", reason: "timeout" }, {}, {}],
    });
  });

  it("raises no dead-provider alarm", async () => {
    groq.mockRejectedValue(apiError(503, { isRetryable: true }));
    cerebras.mockRejectedValue(new TypeError("fetch failed"));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    expect(logRecords.filter((entry) => entry.level === "error")).toEqual([]);
  });

  it("does not hide a dead candidate behind an undecided one", async () => {
    groq.mockRejectedValue(apiError(503, { isRetryable: true }));
    cerebras.mockRejectedValue(apiError(402));
    const { checkProviderHealth } = await loadHealth();

    await expect(checkProviderHealth()).resolves.toMatchObject({
      status: "dead",
    });
  });
});

describe("the verdicts the check remembers", () => {
  it("answers from memory until six hours have passed", async () => {
    const { checkProviderHealth } = await loadHealth();
    const first = await checkProviderHealth();

    vi.setSystemTime(NOW + OK_TTL_MS - 1);
    const second = await checkProviderHealth();

    expect(probeCounts()).toEqual([1, 1, 1]);
    expect(second).toEqual(first);
  });

  it("probes again at the six-hour mark", async () => {
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + OK_TTL_MS);
    const report = await checkProviderHealth();

    expect(probeCounts()).toEqual([2, 2, 2]);
    expect(report.providers[0].checkedAt).toBe("2026-10-03T18:00:00.000Z");
  });

  it("resolves the chain once, however many rounds follow", async () => {
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + OK_TTL_MS);
    await checkProviderHealth();

    expect(selectModelsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a dead verdict for fifteen minutes without probing or logging it again", async () => {
    cerebras.mockRejectedValue(apiError(402));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + DEAD_TTL_MS - 1);
    const report = await checkProviderHealth();

    expect(report.status).toBe("dead");
    expect(probeCounts()).toEqual([1, 1, 1]);
    expect(deadLogs()).toHaveLength(1);
  });

  it("asks a dead candidate again at the fifteen-minute mark, and it alone", async () => {
    cerebras.mockRejectedValueOnce(apiError(402));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + DEAD_TTL_MS);
    const report = await checkProviderHealth();

    expect(probeCounts()).toEqual([1, 2, 1]);
    expect(report.status).toBe("ok");
    expect(report.providers[1]).toEqual({
      provider: "cerebras",
      modelId: "gpt-oss-120b",
      state: "ok",
      reason: null,
      checkedAt: "2026-10-03T12:15:00.000Z",
    });
  });

  it("gives a confirmed dead verdict a fresh fifteen minutes", async () => {
    cerebras.mockRejectedValue(apiError(402));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + DEAD_TTL_MS);
    const confirmed = await checkProviderHealth();

    vi.setSystemTime(NOW + 2 * DEAD_TTL_MS - 1);
    await checkProviderHealth();

    expect(confirmed.providers[1]).toMatchObject({
      state: "dead",
      checkedAt: "2026-10-03T12:15:00.000Z",
    });
    expect(probeCounts()).toEqual([1, 2, 1]);
  });

  it("holds an undecided candidate back for ten minutes", async () => {
    google.mockRejectedValueOnce(apiError(503, { isRetryable: true }));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + UNKNOWN_TTL_MS - 1);
    const report = await checkProviderHealth();

    expect(report.status).toBe("unknown");
    expect(probeCounts()).toEqual([1, 1, 1]);
  });

  it("then retries that candidate alone, leaving the decided ones in memory", async () => {
    google.mockRejectedValueOnce(apiError(503, { isRetryable: true }));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + UNKNOWN_TTL_MS);
    const report = await checkProviderHealth();

    expect(probeCounts()).toEqual([1, 1, 2]);
    expect(report.status).toBe("ok");
    expect(report.providers.map((health) => health.checkedAt)).toEqual([
      CHECKED_AT_START,
      CHECKED_AT_START,
      "2026-10-03T12:10:00.000Z",
    ]);
  });

  it("remembers a timed-out probe, so a silent provider is not asked twice", async () => {
    groq.mockImplementation(stalled);
    const { checkProviderHealth } = await loadHealth();

    const first = checkProviderHealth();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    await first;
    await checkProviderHealth();

    expect(probeCounts()).toEqual([1, 1, 1]);
  });
});

describe("the provider dead line", () => {
  it("is not repeated while probes keep confirming the verdict", async () => {
    cerebras.mockRejectedValue(apiError(402));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + DEAD_TTL_MS);
    await checkProviderHealth();
    vi.setSystemTime(NOW + 2 * DEAD_TTL_MS);
    await checkProviderHealth();

    expect(probeCounts()).toEqual([1, 3, 1]);
    expect(deadLogs()).toHaveLength(1);
    expect(logRecords).toHaveLength(1);
  });

  it("is logged when a candidate that used to answer dies", async () => {
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    cerebras.mockRejectedValue(apiError(402));
    vi.setSystemTime(NOW + OK_TTL_MS);
    await checkProviderHealth();

    expect(deadLogs().map((entry) => entry.data.provider)).toEqual([
      "cerebras",
    ]);
  });

  it("is logged when an undecided candidate turns out dead", async () => {
    cerebras
      .mockRejectedValueOnce(apiError(503))
      .mockRejectedValueOnce(apiError(402));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();
    expect(deadLogs()).toEqual([]);

    vi.setSystemTime(NOW + UNKNOWN_TTL_MS);
    await checkProviderHealth();

    expect(deadLogs()).toHaveLength(1);
  });

  it("is logged again when the candidate dies after an undecided round", async () => {
    cerebras
      .mockRejectedValueOnce(apiError(402))
      .mockRejectedValueOnce(apiError(503))
      .mockRejectedValueOnce(apiError(402));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + DEAD_TTL_MS);
    await checkProviderHealth();
    vi.setSystemTime(NOW + DEAD_TTL_MS + UNKNOWN_TTL_MS);
    const report = await checkProviderHealth();

    expect(report.providers[1].state).toBe("dead");
    expect(deadLogs()).toHaveLength(2);
    expect(recoveredLogs()).toEqual([]);
  });

  it("is logged afresh by a process that has just started", async () => {
    cerebras.mockRejectedValue(apiError(402));
    await (await loadHealth()).checkProviderHealth();
    await (await loadHealth()).checkProviderHealth();

    expect(deadLogs()).toHaveLength(2);
  });
});

describe("the provider recovered line", () => {
  it("is logged once, at info, when a dead candidate answers a probe again", async () => {
    cerebras.mockRejectedValueOnce(apiError(402));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + DEAD_TTL_MS);
    await checkProviderHealth();
    vi.setSystemTime(NOW + DEAD_TTL_MS + OK_TTL_MS);
    await checkProviderHealth();

    expect(recoveredLogs()).toEqual([
      {
        level: "info",
        msg: RECOVERED_MESSAGE,
        data: { provider: "cerebras", modelId: "gpt-oss-120b" },
      },
    ]);
    expect(deadLogs()).toHaveLength(1);
  });

  it("counts a throttled answer as answering again", async () => {
    cerebras
      .mockRejectedValueOnce(apiError(402))
      .mockRejectedValueOnce(apiError(429));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + DEAD_TTL_MS);
    const report = await checkProviderHealth();

    expect(report.providers[1]).toMatchObject({
      state: "ok",
      reason: "rate-limit",
    });
    expect(recoveredLogs()).toHaveLength(1);
  });

  it("follows a dead mark a review left, too", async () => {
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log } = reviewLogger();
    recordProviderFailure(CEREBRAS, "auth", apiError(402), log);

    vi.setSystemTime(NOW + DEAD_TTL_MS);
    await checkProviderHealth();

    expect(recoveredLogs().map((entry) => entry.data.provider)).toEqual([
      "cerebras",
    ]);
  });

  it("is not logged for a dead candidate that merely goes quiet", async () => {
    cerebras
      .mockRejectedValueOnce(apiError(402))
      .mockRejectedValueOnce(apiError(503));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + DEAD_TTL_MS);
    const report = await checkProviderHealth();

    expect(report.providers[1].state).toBe("unknown");
    expect(recoveredLogs()).toEqual([]);
  });

  it("is not logged when the answer comes only after an undecided round", async () => {
    cerebras
      .mockRejectedValueOnce(apiError(402))
      .mockRejectedValueOnce(apiError(503));
    const { checkProviderHealth } = await loadHealth();
    await checkProviderHealth();

    vi.setSystemTime(NOW + DEAD_TTL_MS);
    await checkProviderHealth();
    vi.setSystemTime(NOW + DEAD_TTL_MS + UNKNOWN_TTL_MS);
    const report = await checkProviderHealth();

    expect(report.providers[1].state).toBe("ok");
    expect(recoveredLogs()).toEqual([]);
  });
});

describe("callers that arrive while a round is in flight", () => {
  it("share that round instead of starting their own", async () => {
    let release = (): void => {};
    groq.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(answered());
        }),
    );
    const { checkProviderHealth } = await loadHealth();

    const first = checkProviderHealth();
    await vi.advanceTimersByTimeAsync(0);
    expect(probeCounts()).toEqual([1, 1, 1]);

    const second = checkProviderHealth();
    const third = checkProviderHealth();
    await vi.advanceTimersByTimeAsync(0);
    release();

    const reports = await Promise.all([first, second, third]);

    expect(probeCounts()).toEqual([1, 1, 1]);
    expect(reports[1]).toEqual(reports[0]);
    expect(reports[2]).toEqual(reports[0]);
  });
});

describe("mock mode", () => {
  it("says so and never touches a provider", async () => {
    envMock.MOCK_REVIEW = true;
    const { checkProviderHealth } = await loadHealth();

    await expect(checkProviderHealth()).resolves.toEqual({
      status: "mock",
      providers: [],
    });
    expect(selectModelsMock).not.toHaveBeenCalled();
    expect(probeCounts()).toEqual([0, 0, 0]);
  });
});

describe("a server key refused in the middle of a review", () => {
  it("marks the candidate dead at once, without a probe of its own", async () => {
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log } = reviewLogger();

    recordProviderFailure(CEREBRAS, "auth", apiError(402), log);
    const report = await checkProviderHealth();

    expect(report.status).toBe("dead");
    expect(report.providers[1]).toEqual({
      provider: "cerebras",
      modelId: "gpt-oss-120b",
      state: "dead",
      reason: "auth",
      checkedAt: CHECKED_AT_START,
    });
    expect(probeCounts()).toEqual([1, 0, 1]);
  });

  it("counts a vanished model as dead too", async () => {
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log } = reviewLogger();

    recordProviderFailure(GOOGLE, "unavailable", apiError(404), log);
    const report = await checkProviderHealth();

    expect(report.providers[2]).toMatchObject({
      state: "dead",
      reason: "unavailable",
    });
  });

  it("logs it at error on the review's own logger, apart from the failover line", async () => {
    const { recordProviderFailure } = await loadHealth();
    const { log, errors } = reviewLogger();
    const paymentRequired = apiError(402);

    recordProviderFailure(CEREBRAS, "auth", paymentRequired, log);

    expect(errors).toEqual([
      [
        {
          provider: "cerebras",
          modelId: "gpt-oss-120b",
          reason: "auth",
          err: paymentRequired,
          source: "review",
        },
        DEAD_MESSAGE,
      ],
    ]);
    expect(DEAD_MESSAGE).not.toContain("failover");
    expect(logRecords).toEqual([]);
  });

  it("overrides an ok verdict that was still fresh, and logs it", async () => {
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log, errors } = reviewLogger();
    await checkProviderHealth();

    vi.setSystemTime(NOW + HOUR_MS);
    recordProviderFailure(GROQ, "auth", apiError(401), log);
    const report = await checkProviderHealth();

    expect(report.providers[0]).toMatchObject({
      state: "dead",
      reason: "auth",
      checkedAt: "2026-10-03T13:00:00.000Z",
    });
    expect(probeCounts()).toEqual([1, 1, 1]);
    expect(errors).toHaveLength(1);
  });

  it("logs a candidate that was merely undecided before", async () => {
    cerebras.mockRejectedValueOnce(apiError(503));
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log, errors } = reviewLogger();
    await checkProviderHealth();

    recordProviderFailure(CEREBRAS, "auth", apiError(402), log);

    expect(errors).toHaveLength(1);
  });

  it("stays silent when later reviews hit the same dead candidate", async () => {
    const { recordProviderFailure } = await loadHealth();
    const { log, errors } = reviewLogger();

    recordProviderFailure(CEREBRAS, "auth", apiError(402), log);
    recordProviderFailure(CEREBRAS, "auth", apiError(402), log);
    recordProviderFailure(CEREBRAS, "unavailable", apiError(404), log);

    expect(errors).toHaveLength(1);
  });

  it("still restarts the fifteen minutes on each of those reviews", async () => {
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log } = reviewLogger();
    recordProviderFailure(CEREBRAS, "auth", apiError(402), log);

    vi.setSystemTime(NOW + 5 * MINUTE_MS);
    recordProviderFailure(CEREBRAS, "auth", apiError(402), log);

    vi.setSystemTime(NOW + 5 * MINUTE_MS + DEAD_TTL_MS - 1);
    const report = await checkProviderHealth();

    expect(report.providers[1]).toMatchObject({
      state: "dead",
      checkedAt: "2026-10-03T12:05:00.000Z",
    });
    expect(cerebras).not.toHaveBeenCalled();
  });

  it("stays silent about a candidate a probe had already found dead", async () => {
    cerebras.mockRejectedValue(apiError(402));
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log, errors } = reviewLogger();
    await checkProviderHealth();

    vi.setSystemTime(NOW + DEAD_TTL_MS + MINUTE_MS);
    recordProviderFailure(CEREBRAS, "auth", apiError(402), log);

    expect(errors).toEqual([]);
    expect(deadLogs()).toHaveLength(1);
  });

  it("is confirmed by the next probe without a second line", async () => {
    cerebras.mockRejectedValue(apiError(402));
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log, errors } = reviewLogger();
    recordProviderFailure(CEREBRAS, "auth", apiError(402), log);

    vi.setSystemTime(NOW + DEAD_TTL_MS);
    const report = await checkProviderHealth();

    expect(report.providers[1].state).toBe("dead");
    expect(cerebras).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
    expect(deadLogs()).toEqual([]);
  });

  it("logs again when the candidate recovers and is then refused once more", async () => {
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log, errors } = reviewLogger();
    recordProviderFailure(CEREBRAS, "auth", apiError(402), log);

    vi.setSystemTime(NOW + DEAD_TTL_MS);
    await checkProviderHealth();
    recordProviderFailure(CEREBRAS, "auth", apiError(402), log);

    expect(recoveredLogs()).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });

  it("holds the dead verdict for fifteen minutes from the failure, then probes", async () => {
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log } = reviewLogger();
    await checkProviderHealth();

    vi.setSystemTime(NOW + HOUR_MS);
    recordProviderFailure(GROQ, "auth", apiError(401), log);

    vi.setSystemTime(NOW + HOUR_MS + DEAD_TTL_MS - 1);
    expect((await checkProviderHealth()).providers[0].state).toBe("dead");
    expect(groq).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + HOUR_MS + DEAD_TTL_MS);
    expect((await checkProviderHealth()).providers[0].state).toBe("ok");
    expect(groq).toHaveBeenCalledTimes(2);
  });
});

describe("a review failure the health cache ignores", () => {
  it.each([
    "rate-limit",
    "provider-limit",
    "overloaded",
    "server",
    "timeout",
    "context-overflow",
    "unknown",
  ] as const)("leaves the cache and the log alone on %s", async (reason) => {
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log, errors } = reviewLogger();

    recordProviderFailure(CEREBRAS, reason, apiError(500), log);
    const report = await checkProviderHealth();

    expect(errors).toEqual([]);
    expect(report.status).toBe("ok");
    expect(probeCounts()).toEqual([1, 1, 1]);
  });

  it.each([400, 422])(
    "ignores a %i from a review, which can be about the transcript",
    async (status) => {
      const { checkProviderHealth, recordProviderFailure } = await loadHealth();
      const { log, errors } = reviewLogger();

      recordProviderFailure(CEREBRAS, "unknown", apiError(status), log);
      const report = await checkProviderHealth();

      expect(errors).toEqual([]);
      expect(report.status).toBe("ok");
      expect(probeCounts()).toEqual([1, 1, 1]);
    },
  );

  it("ignores a refusal of the caller's own key", async () => {
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log, errors } = reviewLogger();
    const ownKey = candidate("cerebras", "gpt-oss-120b", cerebras, true);

    recordProviderFailure(ownKey, "unavailable", apiError(404), log);
    const report = await checkProviderHealth();

    expect(errors).toEqual([]);
    expect(report.status).toBe("ok");
    expect(probeCounts()).toEqual([1, 1, 1]);
  });

  it("ignores an injected refusal in mock mode", async () => {
    const { checkProviderHealth, recordProviderFailure } = await loadHealth();
    const { log, errors } = reviewLogger();

    envMock.MOCK_REVIEW = true;
    recordProviderFailure(CEREBRAS, "auth", apiError(401), log);
    envMock.MOCK_REVIEW = false;
    const report = await checkProviderHealth();

    expect(errors).toEqual([]);
    expect(report.status).toBe("ok");
    expect(probeCounts()).toEqual([1, 1, 1]);
  });
});
