import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";

import { HANDOFF_NUDGE } from "@/lib/review/system-prompt";
import type { GithubAccess } from "@/lib/github/octokit";
import type { PRRef } from "@/lib/github/parse-url";

type LogRecord = {
  level: string;
  data: Record<string, unknown>;
  msg: string;
};

type StreamChunk = { type: string } & Record<string, unknown>;

type FixtureFactory = (pr: PRRef) => GithubAccess;

const { transcripts, logRecords, saveReviewMock, githubAccessMock } =
  vi.hoisted(() => ({
    transcripts: [] as unknown[][],
    logRecords: [] as LogRecord[],
    saveReviewMock: vi.fn(),
    githubAccessMock: vi.fn(),
  }));

vi.mock("@/lib/redis", () => ({
  redis: { isReady: false, isOpen: true },
  ensureRedisConnection: async () => {},
}));

vi.mock("@/lib/db/reviews", () => ({ saveReview: saveReviewMock }));

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

vi.mock("@/lib/review/budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/review/budget")>();

  return {
    ...actual,
    estimateInputTokens: (
      messages: Parameters<typeof actual.estimateInputTokens>[0],
      tools: Parameters<typeof actual.estimateInputTokens>[1],
      maxOutputTokens?: number,
    ) => {
      transcripts.push(JSON.parse(JSON.stringify(messages)) as unknown[]);
      return actual.estimateInputTokens(messages, tools, maxOutputTokens);
    },
  };
});

vi.mock("@/lib/github/octokit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github/octokit")>();
  return { ...actual, createGithubAccess: githubAccessMock };
});

const PR_URL = "https://github.com/vercel/ms/pull/17";
const REQUEST_ID = "6b7d1d94-5a2a-4f0a-9c1e-2e0d5a6c7b81";
const CLIENT_IP = "203.0.113.7";
const ORPHANED_TOOL_CALL_ID = "mock-orphaned-call";
const TICK_MS = 250;
const TICK_LIMIT = 4_000;

type LoadOptions = {
  scenario?: string;
  error?: string;
  offline?: boolean;
  persist?: boolean;
};

type LoadedReview = {
  runReview: typeof import("@/lib/review/run-review").runReview;
  fixture: FixtureFactory;
};

const loadRunReview = async (
  options: LoadOptions = {},
): Promise<LoadedReview> => {
  vi.stubEnv("MOCK_REVIEW", "1");
  vi.stubEnv("MOCK_OFFLINE", options.offline === false ? undefined : "1");
  vi.stubEnv("MOCK_PERSIST", options.persist ? "1" : undefined);
  vi.stubEnv("MOCK_SCENARIO", options.scenario);
  vi.stubEnv("MOCK_ERROR", options.error);
  vi.resetModules();

  const [{ runReview }, { createFixtureGithubAccess }] = await Promise.all([
    import("@/lib/review/run-review"),
    import("@/lib/review/mock/github-fixture"),
  ]);

  githubAccessMock.mockImplementation((_token: string | null, pr: PRRef) =>
    createFixtureGithubAccess(pr),
  );

  return { runReview, fixture: createFixtureGithubAccess };
};

const privateAccess =
  (fixture: FixtureFactory) =>
  (_token: string | null, pr: PRRef): GithubAccess => {
    const base = fixture(pr);
    return {
      ...base,
      getPRMetadata: async () => ({
        ...(await base.getPRMetadata()),
        isPrivate: true,
      }),
    };
  };

const parseChunks = (lines: string[]): StreamChunk[] =>
  lines
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .filter((payload) => payload !== "[DONE]")
    .map((payload) => JSON.parse(payload) as StreamChunk);

const consume = async (
  response: Response,
  onChunk?: (chunk: StreamChunk) => void,
): Promise<StreamChunk[]> => {
  const body = response.body;
  if (!body) throw new Error("the review response carried no stream");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: StreamChunk[] = [];
  let buffered = "";
  let drained = false;

  const pump = (async () => {
    for (;;) {
      const read = await reader.read();
      if (read.done) break;

      buffered += decoder.decode(read.value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";

      for (const chunk of parseChunks(lines)) {
        chunks.push(chunk);
        onChunk?.(chunk);
      }
    }
    drained = true;
  })();

  for (let tick = 0; tick < TICK_LIMIT && !drained; tick++) {
    await vi.advanceTimersByTimeAsync(TICK_MS);
  }

  if (!drained) throw new Error("the review stream never finished");
  await pump;

  return chunks;
};

const call = (
  runReview: LoadedReview["runReview"],
  options: { signal?: AbortSignal; githubPat?: string } = {},
): Promise<Response> =>
  runReview({
    prUrl: PR_URL,
    signal: options.signal ?? new AbortController().signal,
    githubPat: options.githubPat,
    ip: CLIENT_IP,
    requestId: REQUEST_ID,
  });

const review = async (
  runReview: LoadedReview["runReview"],
  options: {
    signal?: AbortSignal;
    githubPat?: string;
    onChunk?: (chunk: StreamChunk) => void;
  } = {},
): Promise<StreamChunk[]> =>
  consume(await call(runReview, options), options.onChunk);

const dataOf = (
  chunks: StreamChunk[],
  type: string,
): Record<string, unknown>[] =>
  chunks
    .filter((chunk) => chunk.type === type)
    .map((chunk) => chunk.data as Record<string, unknown>);

const messagesOf = (index: number): ModelMessage[] =>
  transcripts[index] as ModelMessage[];

const notSavedReasons = (): unknown[] =>
  logRecords
    .filter((entry) => entry.msg === "review not saved")
    .map((entry) => entry.data.reason);

beforeEach(() => {
  transcripts.length = 0;
  logRecords.length = 0;
  saveReviewMock.mockReset();
  saveReviewMock.mockResolvedValue("vercel-ms-17-7c2d4f1b");
  githubAccessMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("a chain where every model stops on length", () => {
  it("hands off on output-truncated at each hop and never saves the last link", async () => {
    const { runReview } = await loadRunReview({ scenario: "finish-length" });
    const chunks = await review(runReview);

    expect(dataOf(chunks, "data-failover")).toEqual([
      { from: "groq", to: "cerebras", reason: "output-truncated" },
      { from: "cerebras", to: "google", reason: "output-truncated" },
    ]);
    expect(dataOf(chunks, "data-outcome")).toEqual([
      { incomplete: true, saveFailed: false },
    ]);
    expect(saveReviewMock).not.toHaveBeenCalled();
    expect(notSavedReasons()).toEqual(["truncated"]);
  });

  it("walks the whole chain and shows no error card while it still has links", async () => {
    const { runReview } = await loadRunReview({ scenario: "finish-length" });
    const chunks = await review(runReview);

    expect(transcripts).toHaveLength(3);
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([]);
    expect(dataOf(chunks, "data-meta").map((meta) => meta.model)).toEqual([
      "openai/gpt-oss-120b",
      "gpt-oss-120b",
      "gemini-2.5-flash",
    ]);
  });

  it("keeps the orphaned tool result out of every successor's transcript", async () => {
    const { runReview } = await loadRunReview({ scenario: "finish-length" });
    await review(runReview);

    for (const transcript of transcripts.slice(1)) {
      expect(JSON.stringify(transcript)).not.toContain(ORPHANED_TOOL_CALL_ID);
    }
  });

  it("still hands the successor the tool results that had a call of their own", async () => {
    const { runReview } = await loadRunReview({ scenario: "finish-length" });
    await review(runReview);

    const inherited = JSON.stringify(transcripts[1]);

    expect(inherited).toContain("length-call-1");
    expect(inherited).toContain("length-call-3");
    expect(inherited).toContain("tool-result");
  });

  it("drops reasoning and empty text instead of forwarding them", async () => {
    const { runReview } = await loadRunReview({ scenario: "finish-length" });
    await review(runReview);

    const parts = messagesOf(1)
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        typeof message.content === "string" ? [] : message.content,
      );

    expect(parts).not.toHaveLength(0);
    expect(parts.filter((part) => part.type === "reasoning")).toEqual([]);
    expect(
      parts.filter((part) => part.type === "text" && part.text === ""),
    ).toEqual([]);
  });

  it("leaves no tool result whose call the successor never saw", async () => {
    const { runReview } = await loadRunReview({ scenario: "finish-length" });
    await review(runReview);

    const messages = messagesOf(1);
    const callIds = new Set(
      messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          typeof message.content === "string" ? [] : message.content,
        )
        .flatMap((part) =>
          part.type === "tool-call" ? [part.toolCallId] : [],
        ),
    );
    const resultIds = messages
      .filter((message) => message.role === "tool")
      .flatMap((message) => message.content)
      .flatMap((part) =>
        part.type === "tool-result" ? [part.toolCallId] : [],
      );

    expect(resultIds).not.toHaveLength(0);
    for (const id of resultIds) {
      expect(callIds.has(id)).toBe(true);
    }
  });

  it("hands the successor each inherited tool call exactly once", async () => {
    const { runReview } = await loadRunReview({ scenario: "finish-length" });
    await review(runReview);

    for (const index of [1, 2]) {
      const callIds = messagesOf(index)
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          typeof message.content === "string" ? [] : message.content,
        )
        .flatMap((part) =>
          part.type === "tool-call" ? [part.toolCallId] : [],
        );

      expect(callIds).not.toHaveLength(0);
      expect(new Set(callIds).size).toBe(callIds.length);
    }
  });

  it("nudges each successor that it inherited an unfinished draft", async () => {
    const { runReview } = await loadRunReview({ scenario: "finish-length" });
    await review(runReview);

    for (let index = 1; index < transcripts.length; index++) {
      expect(messagesOf(index).at(-1)).toEqual({
        role: "user",
        content: HANDOFF_NUDGE,
      });
    }

    expect(messagesOf(0)).toHaveLength(1);
  });
});

describe("a chain whose first model dies mid-stream", () => {
  it("recovers on the next candidate and reports a complete review", async () => {
    const { runReview } = await loadRunReview({ error: "first-only" });
    const chunks = await review(runReview);

    expect(dataOf(chunks, "data-failover")).toEqual([
      { from: "groq", to: "cerebras", reason: "server" },
    ]);
    expect(dataOf(chunks, "data-outcome")).toEqual([
      { incomplete: false, saveFailed: false },
    ]);
    expect(transcripts).toHaveLength(2);
  });

  it("passes the sanitized transcript and the nudge to the model that recovers", async () => {
    const { runReview } = await loadRunReview({ error: "first-only" });
    await review(runReview);

    const messages = messagesOf(1);

    expect(JSON.stringify(messages)).not.toContain(ORPHANED_TOOL_CALL_ID);
    expect(messages.at(-1)).toEqual({ role: "user", content: HANDOFF_NUDGE });
    expect(messages.length).toBeGreaterThan(2);
  });

  it("skips the save because the run is a mock, not because it failed", async () => {
    const { runReview } = await loadRunReview({ error: "first-only" });
    await review(runReview);

    expect(saveReviewMock).not.toHaveBeenCalled();
    expect(notSavedReasons()).toEqual(["mock"]);
  });

  it("emits the issues the recovered model found", async () => {
    const { runReview } = await loadRunReview({ error: "first-only" });
    const chunks = await review(runReview);

    expect(dataOf(chunks, "data-issue").length).toBeGreaterThan(0);
  });
});

describe("a review the client walks away from", () => {
  it("marks the run incomplete and saves nothing", async () => {
    const { runReview } = await loadRunReview();
    const controller = new AbortController();

    const chunks = await review(runReview, {
      signal: controller.signal,
      onChunk: (chunk) => {
        if (chunk.type === "text-delta") controller.abort();
      },
    });

    expect(dataOf(chunks, "data-outcome")).toEqual([
      { incomplete: true, saveFailed: false },
    ]);
    expect(saveReviewMock).not.toHaveBeenCalled();
    expect(notSavedReasons()).toEqual(["aborted"]);
  });

  it("answers 499 when the caller leaves while GitHub is still loading", async () => {
    const { runReview, fixture } = await loadRunReview({ offline: false });
    const controller = new AbortController();

    githubAccessMock.mockImplementation((_token: string | null, pr: PRRef) => ({
      ...fixture(pr),
      getPRMetadata: async () => {
        controller.abort();
        const aborted = new Error("The operation was aborted");
        aborted.name = "AbortError";
        throw aborted;
      },
    }));

    const response = await call(runReview, { signal: controller.signal });

    expect(response.status).toBe(499);
    expect(transcripts).toHaveLength(0);
    expect(logRecords.filter((entry) => entry.level === "error")).toEqual([]);
  });

  it("answers 499 without opening a stream when the signal is already dead", async () => {
    const { runReview } = await loadRunReview();
    const controller = new AbortController();
    controller.abort();

    const response = await call(runReview, { signal: controller.signal });

    expect(response.status).toBe(499);
    expect(transcripts).toHaveLength(0);
  });
});

describe("a private pull request", () => {
  it("is refused outright when the caller brought no token", async () => {
    const { runReview, fixture } = await loadRunReview({ offline: false });
    githubAccessMock.mockImplementation(privateAccess(fixture));

    const response = await call(runReview);

    expect(response.status).toBe(403);
    expect(response.headers.get("x-review-error")).toBe("private");
    expect(transcripts).toHaveLength(0);
  });

  it("is reviewed with the caller's token but never written to the database", async () => {
    const { runReview, fixture } = await loadRunReview({ offline: false });
    githubAccessMock.mockImplementation(privateAccess(fixture));

    const chunks = await review(runReview, { githubPat: "ghp_caller" });

    expect(dataOf(chunks, "data-outcome")).toEqual([
      { incomplete: false, saveFailed: false },
    ]);
    expect(saveReviewMock).not.toHaveBeenCalled();
    expect(notSavedReasons()).toEqual(["private"]);
  });
});

describe("a pull request GitHub will not hand over", () => {
  it("answers with the GitHub card before any model is asked", async () => {
    const { runReview, fixture } = await loadRunReview({ offline: false });
    const { NotFoundError } = await import("@/lib/github/octokit/errors");

    githubAccessMock.mockImplementation((_token: string | null, pr: PRRef) => ({
      ...fixture(pr),
      getPRMetadata: async () => {
        throw new NotFoundError("PR vercel/ms#17");
      },
    }));

    const response = await call(runReview);

    expect(response.status).toBe(404);
    expect(response.headers.get("x-review-error")).toBe("load");
    expect(transcripts).toHaveLength(0);
  });
});

describe("a review that is allowed to persist", () => {
  it("saves once the run is complete and announces the share link", async () => {
    const { runReview } = await loadRunReview({ persist: true });
    const chunks = await review(runReview);

    expect(saveReviewMock).toHaveBeenCalledTimes(1);
    expect(dataOf(chunks, "data-share")).toEqual([
      { slug: "vercel-ms-17-7c2d4f1b" },
    ]);
    expect(dataOf(chunks, "data-outcome")).toEqual([
      { incomplete: false, saveFailed: false },
    ]);
  });

  it("reports a failed save instead of pretending the review was shared", async () => {
    const { runReview } = await loadRunReview({ persist: true });
    saveReviewMock.mockRejectedValue(new Error("connection refused"));

    const chunks = await review(runReview);

    expect(dataOf(chunks, "data-share")).toEqual([]);
    expect(dataOf(chunks, "data-outcome")).toEqual([
      { incomplete: false, saveFailed: true },
    ]);
  });
});
