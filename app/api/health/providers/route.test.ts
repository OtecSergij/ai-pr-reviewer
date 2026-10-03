import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HealthState,
  ProviderHealth,
  ProviderHealthReport,
} from "@/lib/ai/provider-health";

const { checkProviderHealthMock } = vi.hoisted(() => ({
  checkProviderHealthMock: vi.fn(),
}));

vi.mock("@/lib/ai/provider-health", () => ({
  checkProviderHealth: checkProviderHealthMock,
}));

const { GET } = await import("@/app/api/health/providers/route");

const CHECKED_AT = "2026-10-03T12:00:00.000Z";

const groq = (state: HealthState): ProviderHealth => ({
  provider: "groq",
  modelId: "openai/gpt-oss-120b",
  state,
  reason: state === "ok" ? null : "server",
  checkedAt: CHECKED_AT,
});

const cerebras = (state: HealthState): ProviderHealth => ({
  provider: "cerebras",
  modelId: "gpt-oss-120b",
  state,
  reason: state === "dead" ? "auth" : null,
  checkedAt: CHECKED_AT,
});

const answerWith = async (report: ProviderHealthReport): Promise<Response> => {
  checkProviderHealthMock.mockResolvedValue(report);
  return GET();
};

beforeEach(() => {
  checkProviderHealthMock.mockReset();
});

describe("the status an uptime monitor alerts on", () => {
  it("is 200 while every candidate answers", async () => {
    const response = await answerWith({
      status: "ok",
      providers: [groq("ok"), cerebras("ok")],
    });

    expect(response.status).toBe(200);
  });

  it("is 503 as soon as one candidate is dead, though the rest still work", async () => {
    const response = await answerWith({
      status: "dead",
      providers: [groq("ok"), cerebras("dead")],
    });

    expect(response.status).toBe(503);
  });

  it("stays 200 when a candidate is merely undecided", async () => {
    const response = await answerWith({
      status: "unknown",
      providers: [groq("unknown"), cerebras("ok")],
    });

    expect(response.status).toBe(200);
  });

  it("is 200 in mock mode, where nothing was probed", async () => {
    const response = await answerWith({ status: "mock", providers: [] });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "mock",
      providers: [],
    });
  });
});

describe("the body the route answers with", () => {
  it("is the report as JSON, one entry per candidate", async () => {
    const report: ProviderHealthReport = {
      status: "dead",
      providers: [groq("ok"), cerebras("dead")],
    };
    const response = await answerWith(report);

    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      status: "dead",
      providers: [
        {
          provider: "groq",
          modelId: "openai/gpt-oss-120b",
          state: "ok",
          reason: null,
          checkedAt: CHECKED_AT,
        },
        {
          provider: "cerebras",
          modelId: "gpt-oss-120b",
          state: "dead",
          reason: "auth",
          checkedAt: CHECKED_AT,
        },
      ],
    });
  });

  it.each(["ok", "dead"] as const)(
    "may not be cached by anything in between when the chain is %s",
    async (status) => {
      const response = await answerWith({ status, providers: [] });

      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );
});
