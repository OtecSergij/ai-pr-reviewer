import { beforeEach, describe, expect, it, vi } from "vitest";

const { redisMock, runReviewMock } = vi.hoisted(() => ({
  redisMock: { isReady: true, eval: vi.fn() },
  runReviewMock: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
  redis: redisMock,
  ensureRedisConnection: async () => {},
}));

vi.mock("@/lib/review/run-review", () => ({ runReview: runReviewMock }));

vi.mock("@/lib/log", () => {
  const make = (): Record<string, unknown> => ({
    child: () => make(),
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  });

  return { logger: make() };
});

const { POST } = await import("@/app/api/review/route");

const PR_URL = "https://github.com/vercel/ms/pull/17";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const streamed = (): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } }
  );

const post = (
  options: {
    body?: string;
    contentType?: string | null;
    requestId?: string;
  } = {}
): Promise<Response> => {
  const headers = new Headers();
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  if (options.requestId !== undefined) {
    headers.set("x-request-id", options.requestId);
  }

  return POST(
    new Request("https://reviewer.example/api/review", {
      method: "POST",
      headers,
      body: options.body ?? JSON.stringify({ prUrl: PR_URL }),
    })
  );
};

beforeEach(() => {
  redisMock.isReady = true;
  redisMock.eval.mockReset();
  redisMock.eval.mockResolvedValue([1, 0, 0]);
  runReviewMock.mockReset();
  runReviewMock.mockResolvedValue(streamed());
});

describe("the content type the route insists on", () => {
  it("refuses a request that declares no type at all", async () => {
    const response = await post({ contentType: null });

    expect(response.status).toBe(415);
    expect(response.headers.get("x-review-error")).toBe("load");
    expect(runReviewMock).not.toHaveBeenCalled();
  });

  it("refuses a form post that only looks like a review request", async () => {
    const response = await post({
      contentType: "application/x-www-form-urlencoded",
      body: "prUrl=whatever",
    });

    expect(response.status).toBe(415);
  });

  it("accepts the charset the browser appends", async () => {
    const response = await post({
      contentType: "Application/JSON; charset=utf-8",
    });

    expect(response.status).toBe(200);
    expect(runReviewMock).toHaveBeenCalledTimes(1);
  });
});

describe("the body the route insists on", () => {
  it("answers 400 for a body that is not JSON", async () => {
    const response = await post({ body: "{" });

    expect(response.status).toBe(400);
    expect(response.headers.get("x-review-error")).toBe("load");
    expect(runReviewMock).not.toHaveBeenCalled();
  });

  it("answers 400 when prUrl is missing", async () => {
    const response = await post({ body: JSON.stringify({ url: PR_URL }) });

    expect(response.status).toBe(400);
  });

  it("answers 400 when prUrl is empty", async () => {
    const response = await post({ body: JSON.stringify({ prUrl: "" }) });

    expect(response.status).toBe(400);
  });

  it("answers 400 for a prUrl longer than the schema allows", async () => {
    const response = await post({
      body: JSON.stringify({ prUrl: `${PR_URL}?q=${"x".repeat(2_048)}` }),
    });

    expect(response.status).toBe(400);
  });

  it("answers 400 for an oversized key rather than forwarding it", async () => {
    const response = await post({
      body: JSON.stringify({ prUrl: PR_URL, anthropicKey: "k".repeat(201) }),
    });

    expect(response.status).toBe(400);
    expect(runReviewMock).not.toHaveBeenCalled();
  });

  it("hands the optional credentials through when they fit", async () => {
    await post({
      body: JSON.stringify({
        prUrl: PR_URL,
        anthropicKey: "sk-ant-api03-not-a-real-key",
        githubPat: "ghp_caller",
      }),
    });

    expect(runReviewMock.mock.calls[0][0]).toMatchObject({
      prUrl: PR_URL,
      anthropicKey: "sk-ant-api03-not-a-real-key",
      githubPat: "ghp_caller",
    });
  });
});

describe("the request id the route logs under", () => {
  it("echoes an id the caller already had", async () => {
    const requestId = "6b7d1d94-5a2a-4f0a-9c1e-2e0d5a6c7b81";
    const response = await post({ requestId });

    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(runReviewMock.mock.calls[0][0].requestId).toBe(requestId);
  });

  it("mints its own when the caller sent none", async () => {
    const response = await post();

    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });

  it("refuses an id that is not a uuid and mints one instead", async () => {
    const response = await post({ requestId: "review-42" });

    expect(response.headers.get("x-request-id")).not.toBe("review-42");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });

  it("refuses an id carrying anything that could forge a log line", async () => {
    const response = await post({
      requestId: '00000000-0000-0000-0000-000000000000"} {"level":50',
    });

    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });

  it("stamps the id on a refusal as well as on a review", async () => {
    const requestId = "6b7d1d94-5a2a-4f0a-9c1e-2e0d5a6c7b81";

    expect(
      (await post({ contentType: null, requestId })).headers.get("x-request-id")
    ).toBe(requestId);
    expect(
      (await post({ body: "{", requestId })).headers.get("x-request-id")
    ).toBe(requestId);
  });

  it("stamps the id on the streaming response the review already opened", async () => {
    const requestId = "6b7d1d94-5a2a-4f0a-9c1e-2e0d5a6c7b81";
    const response = await post({ requestId });

    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });
});

describe("the order the route applies its gates in", () => {
  it("refuses a rate-limited caller before it looks at the body", async () => {
    redisMock.eval.mockResolvedValue([0, 1, 600_000]);

    const response = await post({ contentType: null, body: "{" });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(response.headers.get("x-review-error")).toBe("rate-limit");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    expect(runReviewMock).not.toHaveBeenCalled();
  });

  it("lets the request through once the limiter allows it", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(runReviewMock).toHaveBeenCalledTimes(1);
  });
});

describe("a review that blows up before the stream opens", () => {
  it("answers 500 with the review card and the id it logged under", async () => {
    runReviewMock.mockRejectedValue(new Error("boom"));

    const response = await post();

    expect(response.status).toBe(500);
    expect(response.headers.get("x-review-error")).toBe("review");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    await expect(response.text()).resolves.not.toContain("boom");
  });
});
