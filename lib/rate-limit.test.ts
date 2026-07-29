import { afterEach, describe, expect, it, vi } from "vitest";

type RateLimitModule = typeof import("@/lib/rate-limit");

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

describe("rateLimitResponse keeps internals out of the body", () => {
  it("says only how long to wait", async () => {
    const { rateLimitResponse } = await loadRateLimit(undefined);
    const { body } = await refusal(rateLimitResponse, 600_000);

    expect(body).toBe("Try again in ~10 min.");
    expect(body.match(/\d+/g)).toEqual(["10"]);
    expect(body).not.toMatch(/limit|tier|quota|review|redis|hour|day/i);
  });
});
