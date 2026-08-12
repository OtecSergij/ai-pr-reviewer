import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RateLimitModule = typeof import("@/lib/rate-limit");

type LogRecord = { data: Record<string, unknown>; msg: string };

type SortedSetEntry = { score: number; member: string };

const { redisMock, logRecords } = vi.hoisted(() => ({
  redisMock: { isReady: true, eval: vi.fn() },
  logRecords: [] as LogRecord[],
}));

vi.mock("@/lib/redis", () => ({
  redis: redisMock,
  ensureRedisConnection: async () => {},
}));

vi.mock("@/lib/log", () => {
  const record = (data: unknown, msg?: string): void => {
    logRecords.push(
      typeof data === "string"
        ? { data: {}, msg: data }
        : { data: (data ?? {}) as Record<string, unknown>, msg: msg ?? "" }
    );
  };

  const make = (): Record<string, unknown> => ({
    child: () => make(),
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
    fatal: record,
  });

  return { logger: make() };
});

const loadRateLimit = async (
  trustProxy: string | undefined
): Promise<RateLimitModule> => {
  vi.stubEnv("MOCK_REVIEW", "1");
  vi.stubEnv("TRUST_PROXY", trustProxy);
  vi.resetModules();
  return import("@/lib/rate-limit");
};

const forwardedFor = (value?: string): Request =>
  new Request("https://reviewer.example/api/review", {
    headers: value === undefined ? {} : { "x-forwarded-for": value },
  });

const refusal = async (
  rateLimitResponse: RateLimitModule["rateLimitResponse"],
  retryAfterMs: number
): Promise<{ status: number; retryAfter: string | null; body: string }> => {
  const response = rateLimitResponse({ allowed: false, retryAfterMs });
  return {
    status: response.status,
    retryAfter: response.headers.get("retry-after"),
    body: await response.text(),
  };
};

beforeEach(() => {
  logRecords.length = 0;
  redisMock.isReady = true;
  redisMock.eval.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getClientIp without a trusted proxy", () => {
  it("ignores a forwarded-for header a client could have forged", async () => {
    const { getClientIp } = await loadRateLimit(undefined);

    expect(getClientIp(forwardedFor("1.2.3.4, 5.6.7.8"))).toBe("dev");
  });
});

describe("getClientIp behind a trusted proxy", () => {
  it("takes the address the proxy appended", async () => {
    const { getClientIp } = await loadRateLimit("1");

    expect(getClientIp(forwardedFor("1.2.3.4, 5.6.7.8"))).toBe("5.6.7.8");
  });

  it("trims the whitespace around the address", async () => {
    const { getClientIp } = await loadRateLimit("1");

    expect(getClientIp(forwardedFor(" 1.2.3.4 , 5.6.7.8 "))).toBe("5.6.7.8");
  });

  it("lowercases an IPv6 address so one client gets one bucket", async () => {
    const { getClientIp } = await loadRateLimit("1");

    expect(getClientIp(forwardedFor("2001:DB8::AB"))).toBe("2001:db8::ab");
  });

  it("falls back to unknown when the header is missing", async () => {
    const { getClientIp } = await loadRateLimit("1");

    expect(getClientIp(forwardedFor())).toBe("unknown");
  });

  it("falls back to unknown when the header is empty", async () => {
    const { getClientIp } = await loadRateLimit("1");

    expect(getClientIp(forwardedFor(""))).toBe("unknown");
  });

  it("falls back to unknown when the header is blank", async () => {
    const { getClientIp } = await loadRateLimit("1");

    expect(getClientIp(forwardedFor("   "))).toBe("unknown");
  });

  it("falls back to unknown when the header ends with a separator", async () => {
    const { getClientIp } = await loadRateLimit("1");

    expect(getClientIp(forwardedFor("1.2.3.4,"))).toBe("unknown");
  });
});

describe("rateLimitResponse in minutes", () => {
  it("rounds a sub-second wait up to one minute", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);

    expect(await refusal(rateLimitResponse, 1)).toEqual({
      status: 429,
      retryAfter: "1",
      body: "Try again in ~1 min.",
    });
  });

  it("keeps a wait just under a minute at one minute", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);

    expect(await refusal(rateLimitResponse, 59_000)).toEqual({
      status: 429,
      retryAfter: "59",
      body: "Try again in ~1 min.",
    });
  });

  it("keeps a whole minute at one minute", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);

    expect(await refusal(rateLimitResponse, 60_000)).toEqual({
      status: 429,
      retryAfter: "60",
      body: "Try again in ~1 min.",
    });
  });

  it("rounds a wait just over a minute up to two minutes", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);

    expect(await refusal(rateLimitResponse, 60_001)).toEqual({
      status: 429,
      retryAfter: "61",
      body: "Try again in ~2 min.",
    });
  });

  it("stays in minutes up to fifty-nine of them", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);

    expect(await refusal(rateLimitResponse, 3_540_000)).toEqual({
      status: 429,
      retryAfter: "3540",
      body: "Try again in ~59 min.",
    });
  });
});

describe("rateLimitResponse in hours", () => {
  it("switches to hours once the wait rounds up to sixty minutes", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);

    expect(await refusal(rateLimitResponse, 3_599_999)).toEqual({
      status: 429,
      retryAfter: "3600",
      body: "Try again in ~1 h.",
    });
  });

  it("reports a whole hour as one hour", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);

    expect(await refusal(rateLimitResponse, 3_600_000)).toEqual({
      status: 429,
      retryAfter: "3600",
      body: "Try again in ~1 h.",
    });
  });

  it("rounds the body up to whole hours while retry-after stays exact", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);

    expect(await refusal(rateLimitResponse, 3_660_000)).toEqual({
      status: 429,
      retryAfter: "3660",
      body: "Try again in ~2 h.",
    });
  });

  it("reports a full day as twenty-four hours", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);

    expect(await refusal(rateLimitResponse, 86_400_000)).toEqual({
      status: 429,
      retryAfter: "86400",
      body: "Try again in ~24 h.",
    });
  });
});

describe("rateLimitResponse names the card it wants", () => {
  it("labels our own refusal as a rate limit, not as a failed review", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);
    const response = rateLimitResponse({ allowed: false, retryAfterMs: 1_000 });

    expect(response.headers.get("x-review-error")).toBe("rate-limit");
  });
});

describe("rateLimitResponse keeps internals out of the body", () => {
  it("says only how long to wait", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);
    const { body } = await refusal(rateLimitResponse, 600_000);

    expect(body).toBe("Try again in ~10 min.");
    expect(body.match(/\d+/g)).toEqual(["10"]);
    expect(body).not.toMatch(/limit|tier|quota|review|redis|hour|day/i);
  });
});

const CLIENT = "198.51.100.9";
const NOW = 1_700_000_000_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIER_ARGV: Record<string, [string, string]> = {
  hour: [String(HOUR_MS), "8"],
  day: [String(DAY_MS), "10"],
};

const evalCall = (index = 0): { keys: string[]; arguments: string[] } =>
  redisMock.eval.mock.calls[index][1] as {
    keys: string[];
    arguments: string[];
  };

const checkAndConsume = (
  store: Map<string, SortedSetEntry[]>,
  keys: string[],
  argv: string[]
): [number, number, number] => {
  const now = Number(argv[0]);
  let blocked = 0;
  let retryAfter = 0;

  for (let i = 1; i <= keys.length; i++) {
    const window = Number(argv[2 * i]);
    const limit = Number(argv[2 * i + 1]);
    const kept = (store.get(keys[i - 1]) ?? []).filter(
      (entry) => entry.score > now - window
    );
    store.set(keys[i - 1], kept);

    if (kept.length >= limit) {
      const wait = kept[kept.length - limit].score + window - now;
      if (wait > retryAfter) {
        retryAfter = wait;
        blocked = i;
      }
    }
  }

  if (blocked > 0) return [0, blocked, retryAfter];

  for (let i = 1; i <= keys.length; i++) {
    const kept = store.get(keys[i - 1]) ?? [];
    kept.push({ score: now, member: argv[1] });
    kept.sort((a, b) => a.score - b.score);
    store.set(keys[i - 1], kept);
  }

  return [1, 0, 0];
};

const blockedTiers = (): unknown[] =>
  logRecords
    .filter((entry) => entry.msg === "rate limit decision")
    .map((entry) => entry.data.blockedTier);

describe("the arguments check sends to the Lua script", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names one key per tier under the limiter's own prefix", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockResolvedValue([1, 0, 0]);

    await reviewLimiter.check(CLIENT);

    expect(evalCall().keys).toEqual([
      `rl:review:hour:${CLIENT}`,
      `rl:review:day:${CLIENT}`,
    ]);
  });

  it("puts the clock first and one shared member second", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockResolvedValue([1, 0, 0]);

    await reviewLimiter.check(CLIENT);

    const { arguments: argv } = evalCall();

    expect(argv[0]).toBe(String(NOW));
    expect(argv[1]).toMatch(UUID);
  });

  it("pairs every tier's window and limit where the script indexes them", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockResolvedValue([1, 0, 0]);

    await reviewLimiter.check(CLIENT);

    const { keys, arguments: argv } = evalCall();

    expect(argv).toHaveLength(2 * keys.length + 2);

    for (let i = 1; i <= keys.length; i++) {
      const label = keys[i - 1].split(":")[2];
      expect([argv[2 * i], argv[2 * i + 1]]).toEqual(TIER_ARGV[label]);
    }
  });

  it("spells out the free tier's eight an hour and ten a day", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockResolvedValue([1, 0, 0]);

    await reviewLimiter.check(CLIENT);

    expect(evalCall().arguments.slice(2)).toEqual([
      String(HOUR_MS),
      "8",
      String(DAY_MS),
      "10",
    ]);
  });

  it("gives the request limiter its own single hourly tier", async () => {
    const { requestLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockResolvedValue([1, 0, 0]);

    await requestLimiter.check(CLIENT);

    expect(evalCall().keys).toEqual([`rl:req:hour:${CLIENT}`]);
    expect(evalCall().arguments.slice(2)).toEqual([String(HOUR_MS), "25"]);
  });
});

describe("what check makes of the script's reply", () => {
  it("lets a request through when the script consumed a slot", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockResolvedValue([1, 0, 0]);

    await expect(reviewLimiter.check(CLIENT)).resolves.toEqual({
      allowed: true,
    });
  });

  it("passes the wait through untouched when the script refused", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockResolvedValue([0, 1, 1_234_567]);

    await expect(reviewLimiter.check(CLIENT)).resolves.toEqual({
      allowed: false,
      retryAfterMs: 1_234_567,
    });
  });

  it("names the hour tier when the first key was the one that blocked", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockResolvedValue([0, 1, 60_000]);

    await reviewLimiter.check(CLIENT);

    expect(blockedTiers()).toEqual(["hour"]);
  });

  it("names the day tier when the second key was the one that blocked", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockResolvedValue([0, 2, 60_000]);

    await reviewLimiter.check(CLIENT);

    expect(blockedTiers()).toEqual(["day"]);
  });

  it("reports no tier rather than inventing one for an index it has no tier for", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockResolvedValue([0, 9, 60_000]);

    await reviewLimiter.check(CLIENT);

    expect(blockedTiers()).toEqual([null]);
  });
});

describe("a limiter whose Redis is not answering", () => {
  it("lets the request through without running the script at all", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.isReady = false;

    await expect(reviewLimiter.check(CLIENT)).resolves.toEqual({
      allowed: true,
    });
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("lets the request through when the script throws", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockRejectedValue(new Error("NOSCRIPT"));

    await expect(reviewLimiter.check(CLIENT)).resolves.toEqual({
      allowed: true,
    });
  });

  it("lets the request through when the script outlives its half second", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);
    redisMock.eval.mockReturnValue(new Promise(() => {}));

    vi.useFakeTimers();
    const pending = reviewLimiter.check(CLIENT);
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();

    await expect(pending).resolves.toEqual({ allowed: true });
  });
});

describe("the review limiter against a sorted set that behaves like Redis", () => {
  const store = new Map<string, SortedSetEntry[]>();

  beforeEach(() => {
    store.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    redisMock.eval.mockImplementation(
      async (_script: string, options: { keys: string[]; arguments: string[] }) =>
        checkAndConsume(store, options.keys, options.arguments)
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("spends the hourly budget and then refuses for the rest of the hour", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);

    for (let i = 0; i < 8; i++) {
      await expect(reviewLimiter.check(CLIENT)).resolves.toEqual({
        allowed: true,
      });
    }

    await expect(reviewLimiter.check(CLIENT)).resolves.toEqual({
      allowed: false,
      retryAfterMs: HOUR_MS,
    });
    expect(blockedTiers().at(-1)).toBe("hour");
  });

  it("consumes nothing while it is refusing", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);

    for (let i = 0; i < 8; i++) await reviewLimiter.check(CLIENT);
    for (let i = 0; i < 5; i++) await reviewLimiter.check(CLIENT);

    expect(store.get(`rl:review:hour:${CLIENT}`)).toHaveLength(8);
    expect(store.get(`rl:review:day:${CLIENT}`)).toHaveLength(8);
  });

  it("hands the hourly budget back once the window has rolled past", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);

    for (let i = 0; i < 8; i++) await reviewLimiter.check(CLIENT);
    vi.setSystemTime(NOW + HOUR_MS + 1);

    await expect(reviewLimiter.check(CLIENT)).resolves.toEqual({
      allowed: true,
    });
  });

  it("keeps the daily ceiling standing after the hourly window has cleared", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);

    for (let i = 0; i < 8; i++) await reviewLimiter.check(CLIENT);
    vi.setSystemTime(NOW + HOUR_MS + 1);
    for (let i = 0; i < 2; i++) await reviewLimiter.check(CLIENT);

    await expect(reviewLimiter.check(CLIENT)).resolves.toEqual({
      allowed: false,
      retryAfterMs: DAY_MS - HOUR_MS - 1,
    });
    expect(blockedTiers().at(-1)).toBe("day");
  });

  it("quotes the longest wait when both tiers are out of room", async () => {
    const { reviewLimiter } = await loadRateLimit(undefined);

    for (let i = 0; i < 2; i++) await reviewLimiter.check(CLIENT);
    vi.setSystemTime(NOW + HOUR_MS + 1);
    for (let i = 0; i < 8; i++) await reviewLimiter.check(CLIENT);

    await expect(reviewLimiter.check(CLIENT)).resolves.toEqual({
      allowed: false,
      retryAfterMs: DAY_MS - HOUR_MS - 1,
    });
    expect(blockedTiers().at(-1)).toBe("day");
  });
});
