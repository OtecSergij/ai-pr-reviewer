import { describe, it, expect } from "vitest";
import { APICallError, RetryError } from "ai";
import {
  classifyFailure,
  errorKindForReason,
  errorToMessage,
  errorToResponse,
  shownVerdict,
  verdictMessage,
  OUTPUT_TRUNCATED_VERDICT,
  OVER_BUDGET_VERDICT,
  STEPS_EXHAUSTED_VERDICT,
} from "./errors";
import { ttfbTimeoutError } from "@/lib/ai/provider-fetch";
import {
  ForbiddenError,
  GitHubApiError,
  GitHubTimeoutError,
  NotFoundError,
  RateLimitError,
  SecondaryRateLimitError,
  UnauthorizedError,
} from "@/lib/github/octokit/errors";
import { InvalidPRUrl } from "@/lib/github/parse-url";
import type { GitHubError, GitHubErrorCode } from "@/lib/github/error-base";
import type { ErrorKind } from "@/lib/review/transcript";

const INVALID_KEY_MESSAGE = "The API key you entered is invalid.";
const NO_ACCESS_MESSAGE =
  "Your API key doesn't have access to this model, or its quota is exhausted.";
const REVIEW_UNAVAILABLE_MESSAGE =
  "The review service is temporarily unavailable. Please try again later.";
const TRANSIENT_MESSAGE =
  "The review service is busy right now. Please try again in a moment.";
const MODEL_UNAVAILABLE_MESSAGE = "The selected model isn't available.";
const TOO_LARGE_MESSAGE =
  "The diff is too large for the model's context window.";
const CUT_SHORT_MESSAGE =
  "The review was cut short before it finished. Please try again.";

function apiError(opts: {
  statusCode?: number;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  isRetryable?: boolean;
  message?: string;
}): APICallError {
  return new APICallError({
    message: opts.message ?? "api error",
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode: opts.statusCode,
    responseBody: opts.responseBody,
    responseHeaders: opts.responseHeaders,
    isRetryable: opts.isRetryable ?? false,
  });
}

describe("classifyFailure aborts", () => {
  it("treats an AbortError by name as aborted", () => {
    const err = new Error("stopped");
    err.name = "AbortError";
    expect(classifyFailure(err)).toMatchObject({
      hop: false,
      reason: "aborted",
    });
  });

  it("treats a RetryError with reason abort as aborted", () => {
    const err = new RetryError({
      message: "aborted retry",
      reason: "abort",
      errors: [],
    });
    expect(classifyFailure(err)).toMatchObject({
      hop: false,
      reason: "aborted",
    });
  });

  it("refuses to hop, so an abort ends the chain at its own link", () => {
    const err = new Error("stopped");
    err.name = "AbortError";
    expect(classifyFailure(err).hop).toBe(false);
  });
});

describe("classifyFailure unwraps RetryError", () => {
  it("reclassifies the last error of a retry chain", () => {
    const err = new RetryError({
      message: "gave up",
      reason: "maxRetriesExceeded",
      errors: [apiError({ statusCode: 429 })],
    });
    expect(classifyFailure(err)).toMatchObject({
      hop: true,
      reason: "rate-limit",
    });
  });

  it("passes options through when unwrapping", () => {
    const err = new RetryError({
      message: "gave up",
      reason: "maxRetriesExceeded",
      errors: [apiError({ statusCode: 401 })],
    });
    expect(classifyFailure(err, { userKey: true })).toEqual({
      hop: false,
      reason: "auth",
      message: INVALID_KEY_MESSAGE,
    });
  });
});

describe("classifyFailure auth statuses", () => {
  it("distinguishes user-key from service-key on 401", () => {
    expect(
      classifyFailure(apiError({ statusCode: 401 }), { userKey: true }),
    ).toEqual({
      hop: false,
      reason: "auth",
      message: INVALID_KEY_MESSAGE,
    });
    expect(
      classifyFailure(apiError({ statusCode: 401 }), { userKey: false }),
    ).toEqual({
      hop: true,
      reason: "auth",
      message: REVIEW_UNAVAILABLE_MESSAGE,
    });
  });

  it("distinguishes user-key from service-key on 403", () => {
    expect(
      classifyFailure(apiError({ statusCode: 403 }), { userKey: true }),
    ).toEqual({
      hop: false,
      reason: "auth",
      message: NO_ACCESS_MESSAGE,
    });
    expect(
      classifyFailure(apiError({ statusCode: 403 }), { userKey: false }),
    ).toEqual({
      hop: true,
      reason: "auth",
      message: REVIEW_UNAVAILABLE_MESSAGE,
    });
  });

  it("defaults to the service-key branch when userKey is unset", () => {
    expect(classifyFailure(apiError({ statusCode: 401 }))).toMatchObject({
      hop: true,
      reason: "auth",
      message: REVIEW_UNAVAILABLE_MESSAGE,
    });
  });
});

describe("classifyFailure other statuses", () => {
  it("offers another model only to a user key on 404", () => {
    expect(
      classifyFailure(apiError({ statusCode: 404 }), { userKey: true }),
    ).toMatchObject({
      hop: true,
      reason: "unavailable",
      message: MODEL_UNAVAILABLE_MESSAGE,
    });
    expect(
      classifyFailure(apiError({ statusCode: 404 }), { userKey: false }),
    ).toMatchObject({
      hop: true,
      reason: "unavailable",
      message: REVIEW_UNAVAILABLE_MESSAGE,
    });
  });

  it("maps 413 to a provider limit, not to a context overflow", () => {
    expect(classifyFailure(apiError({ statusCode: 413 }))).toMatchObject({
      hop: true,
      reason: "provider-limit",
      message: TRANSIENT_MESSAGE,
    });
  });

  it("reads the Groq TPM refusal as a provider limit", () => {
    expect(
      classifyFailure(
        apiError({
          statusCode: 413,
          message:
            "Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 8078, please reduce your message size",
        }),
      ),
    ).toMatchObject({ reason: "provider-limit" });
  });

  it("maps 429 to rate-limit", () => {
    expect(classifyFailure(apiError({ statusCode: 429 }))).toMatchObject({
      hop: true,
      reason: "rate-limit",
    });
  });

  it("maps 529 to overloaded", () => {
    expect(classifyFailure(apiError({ statusCode: 529 }))).toMatchObject({
      hop: true,
      reason: "overloaded",
    });
  });

  it("carries retry-after seconds from the response headers", () => {
    expect(
      classifyFailure(
        apiError({
          statusCode: 429,
          responseHeaders: { "retry-after": "42" },
        }),
      ),
    ).toMatchObject({ reason: "rate-limit", retryAfterSec: 42 });
  });

  it("ignores an unusable retry-after value", () => {
    expect(
      classifyFailure(
        apiError({
          statusCode: 429,
          responseHeaders: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
        }),
      ).retryAfterSec,
    ).toBeUndefined();
  });

  it("maps a retryable error without a known status to server", () => {
    expect(
      classifyFailure(apiError({ statusCode: 500, isRetryable: true })),
    ).toMatchObject({ hop: true, reason: "server" });
  });

  it("maps an unrecognized non-retryable API error to unknown", () => {
    expect(
      classifyFailure(apiError({ statusCode: 418, isRetryable: false })),
    ).toMatchObject({ hop: true, reason: "unknown" });
  });
});

describe("classifyFailure TTFB timeouts", () => {
  it("reads our synthetic 504 as a timeout that hops", () => {
    expect(
      classifyFailure(ttfbTimeoutError("https://api.groq.com/openai/v1/chat")),
    ).toMatchObject({ hop: true, reason: "timeout" });
  });

  it("does not let the timeout reach the aborted branch", () => {
    expect(
      classifyFailure(ttfbTimeoutError("https://api.groq.com/x")).reason,
    ).not.toBe("aborted");
  });

  it("leaves an unrelated 504 alone", () => {
    expect(
      classifyFailure(apiError({ statusCode: 504, isRetryable: true })),
    ).toMatchObject({ reason: "server" });
  });

  it("survives the retry wrapper", () => {
    const err = new RetryError({
      message: "gave up",
      reason: "maxRetriesExceeded",
      errors: [ttfbTimeoutError("https://api.groq.com/x")],
    });
    expect(classifyFailure(err)).toMatchObject({ reason: "timeout" });
  });
});

describe("classifyFailure Google RetryInfo", () => {
  function resourceExhausted(retryDelay: unknown): string {
    return JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure" },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
        ],
      },
    });
  }

  it("reads the delay Gemini puts in the body instead of the header", () => {
    expect(
      classifyFailure(
        apiError({ statusCode: 429, responseBody: resourceExhausted("36.3s") }),
      ),
    ).toMatchObject({ reason: "rate-limit", retryAfterSec: 37 });
  });

  it("reads the seconds/nanos form too", () => {
    expect(
      classifyFailure(
        apiError({
          statusCode: 429,
          responseBody: resourceExhausted({ seconds: 12, nanos: 500_000_000 }),
        }),
      ).retryAfterSec,
    ).toBe(13);
  });

  it("prefers the header when both are present", () => {
    expect(
      classifyFailure(
        apiError({
          statusCode: 429,
          responseHeaders: { "retry-after": "5" },
          responseBody: resourceExhausted("36.3s"),
        }),
      ).retryAfterSec,
    ).toBe(5);
  });

  it("ignores a body that carries no usable delay", () => {
    for (const body of [
      "not json at all",
      JSON.stringify({ error: { details: [] } }),
      resourceExhausted("0s"),
      resourceExhausted("later"),
      JSON.stringify({
        error: {
          details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure" }],
        },
      }),
    ]) {
      expect(
        classifyFailure(apiError({ statusCode: 429, responseBody: body }))
          .retryAfterSec,
      ).toBeUndefined();
    }
  });
});

describe("classifyFailure context overflow", () => {
  it("maps context-overflow response bodies to context-overflow", () => {
    expect(
      classifyFailure(
        apiError({
          statusCode: 400,
          responseBody: "This model's maximum context length is 200000 tokens",
        }),
      ),
    ).toEqual({
      hop: true,
      reason: "context-overflow",
      message: TOO_LARGE_MESSAGE,
    });
  });

  it("recognizes the Anthropic prompt-length wording", () => {
    expect(
      classifyFailure(
        apiError({
          statusCode: 400,
          responseBody: "prompt is too long: 214000 tokens > 200000 maximum",
        }),
      ),
    ).toMatchObject({ reason: "context-overflow" });
  });

  it("lets a status decide before the message markers do", () => {
    expect(
      classifyFailure(
        apiError({ statusCode: 429, responseBody: "input is too large" }),
      ),
    ).toMatchObject({ hop: true, reason: "rate-limit" });
  });

  it("does not read an unrelated 'too long' as a context overflow", () => {
    expect(
      classifyFailure(
        apiError({
          statusCode: 400,
          message: "the upstream request took too long",
        }),
      ),
    ).toMatchObject({ reason: "unknown" });
  });
});

describe("classifyFailure non-API errors", () => {
  it("maps a plain error to unknown", () => {
    expect(classifyFailure(new Error("boom"))).toMatchObject({
      hop: true,
      reason: "unknown",
    });
  });
});

describe("shownVerdict", () => {
  it("shows the last link's verdict, not the most informative one", () => {
    expect(
      shownVerdict([
        classifyFailure(apiError({ statusCode: 413 })),
        classifyFailure(apiError({ statusCode: 401 })),
        classifyFailure(apiError({ statusCode: 429 })),
      ]),
    ).toMatchObject({ reason: "rate-limit" });
  });

  it("reports the quota for the production auth, auth, rate-limit chain", () => {
    expect(
      shownVerdict([
        classifyFailure(apiError({ statusCode: 401 })),
        classifyFailure(apiError({ statusCode: 401 })),
        classifyFailure(apiError({ statusCode: 429 })),
      ]),
    ).toMatchObject({ reason: "rate-limit", message: TRANSIENT_MESSAGE });
  });

  it("lets an unknown last verdict yield to an earlier concrete one", () => {
    expect(
      shownVerdict([
        classifyFailure(apiError({ statusCode: 429 })),
        classifyFailure(new Error("boom")),
      ]),
    ).toMatchObject({ reason: "rate-limit" });
  });

  it("keeps the last verdict when nothing earlier is concrete", () => {
    expect(
      shownVerdict([
        classifyFailure(new Error("boom")),
        classifyFailure(new Error("boom again")),
      ]),
    ).toMatchObject({ hop: true, reason: "unknown" });
  });

  it("falls back to a generic verdict for an empty list", () => {
    expect(shownVerdict([])).toMatchObject({ hop: true, reason: "unknown" });
  });
});

describe("errorKindForReason", () => {
  it("gives a context overflow the size card instead of Review failed", () => {
    expect(errorKindForReason("context-overflow")).toBe("too-many-files");
  });

  it("keeps a provider's exhausted quota off our own rate-limit card", () => {
    expect(errorKindForReason("rate-limit")).toBe("provider-quota");
    expect(errorKindForReason("provider-limit")).toBe("provider-quota");
  });

  it("sends a transcript no provider can take to the quota card, not the size card", () => {
    expect(errorKindForReason("over-budget")).toBe("provider-quota");
  });

  it("leaves the remaining reasons on the review card", () => {
    for (const reason of [
      "overloaded",
      "server",
      "timeout",
      "output-truncated",
      "steps-exhausted",
      "unavailable",
      "auth",
      "aborted",
      "unknown",
    ] as const) {
      expect(errorKindForReason(reason)).toBe("review");
    }
  });
});

describe("errorToResponse", () => {
  it("ignores anything that is not a GitHub error", () => {
    expect(errorToResponse(new Error("boom"))).toBeUndefined();
  });

  it("labels a GitHub 502 with its own kind instead of a failed review", async () => {
    const res = errorToResponse(new GitHubApiError(502, "Bad Gateway"));
    expect(res?.status).toBe(502);
    expect(res?.headers.get("x-review-error")).toBe("github");
    await expect(res?.text()).resolves.toBe(
      "GitHub API error (502): Bad Gateway",
    );
  });

  it("labels a load failure and a rate limit with the matching kinds", () => {
    expect(
      errorToResponse(new NotFoundError("PR"))?.headers.get("x-review-error"),
    ).toBe("load");
    expect(
      errorToResponse(new UnauthorizedError())?.headers.get("x-review-error"),
    ).toBe("load");
    expect(
      errorToResponse(new SecondaryRateLimitError(60))?.headers.get(
        "x-review-error",
      ),
    ).toBe("github");
  });

  it("keeps GitHub's own throttling off the card that means our limiter", () => {
    for (const error of [
      new RateLimitError(new Date("2026-08-12T09:00:00.000Z")),
      new SecondaryRateLimitError(60),
    ]) {
      expect(errorToResponse(error)?.headers.get("x-review-error")).not.toBe(
        "rate-limit",
      );
    }
  });

  it("keeps a raw GitHub body out of the card", async () => {
    const html = `<html><head><title>Server Error</title></head><body>${"x".repeat(4000)}</body></html>`;
    const body = await errorToResponse(new GitHubApiError(502, html))?.text();
    expect(body?.length).toBeLessThanOrEqual(241);
    expect(body?.endsWith("…")).toBe(true);
  });

  it("leaves a short message untouched", () => {
    expect(errorToMessage(new UnauthorizedError())).toBe(
      "GitHub token is invalid or expired",
    );
  });
});

describe("cut-short verdicts", () => {
  it("separates an output cut-off from a step ceiling", () => {
    expect(OUTPUT_TRUNCATED_VERDICT).toEqual({
      hop: true,
      reason: "output-truncated",
      message: CUT_SHORT_MESSAGE,
    });
    expect(STEPS_EXHAUSTED_VERDICT).toEqual({
      hop: true,
      reason: "steps-exhausted",
      message: CUT_SHORT_MESSAGE,
    });
  });

  it("does not claim the PR is too large", () => {
    expect(OUTPUT_TRUNCATED_VERDICT.message).not.toBe(TOO_LARGE_MESSAGE);
    expect(STEPS_EXHAUSTED_VERDICT.message).not.toBe(TOO_LARGE_MESSAGE);
  });
});

describe("the over-budget verdict", () => {
  it("hops, so a pre-flight skip is a divider and not the end of the run", () => {
    expect(OVER_BUDGET_VERDICT).toMatchObject({
      hop: true,
      reason: "over-budget",
    });
  });

  it("blames the request size rather than the pull request", () => {
    expect(OVER_BUDGET_VERDICT.message).not.toBe(TOO_LARGE_MESSAGE);
    expect(OVER_BUDGET_VERDICT.message).toContain("smaller pull request");
  });
});

describe("GitHub timeouts on the pre-stream path", () => {
  it("answers 504 with the GitHub card rather than a failed review", () => {
    const res = errorToResponse(new GitHubTimeoutError("PR o/r#1", 15_000));
    expect(res?.status).toBe(504);
    expect(res?.headers.get("x-review-error")).toBe("github");
  });
});

const GITHUB_FAILURES: Record<
  GitHubErrorCode,
  { status: number; kind: ErrorKind; error: () => GitHubError }
> = {
  INVALID_PR_URL: {
    status: 400,
    kind: "load",
    error: () => new InvalidPRUrl("not a pull request URL", "example.com"),
  },
  UNAUTHORIZED: {
    status: 401,
    kind: "load",
    error: () => new UnauthorizedError(),
  },
  FORBIDDEN: {
    status: 403,
    kind: "load",
    error: () => new ForbiddenError("Resource not accessible by integration"),
  },
  NOT_FOUND: {
    status: 404,
    kind: "load",
    error: () => new NotFoundError("PR vercel/ms#17"),
  },
  RATE_LIMIT: {
    status: 429,
    kind: "github",
    error: () => new RateLimitError(new Date("2026-08-12T09:00:00.000Z")),
  },
  SECONDARY_RATE_LIMIT: {
    status: 429,
    kind: "github",
    error: () => new SecondaryRateLimitError(60),
  },
  TIMEOUT: {
    status: 504,
    kind: "github",
    error: () => new GitHubTimeoutError("PR vercel/ms#17", 15_000),
  },
  GITHUB_API_ERROR: {
    status: 502,
    kind: "github",
    error: () => new GitHubApiError(502, "Bad Gateway"),
  },
};

const githubFailures = Object.entries(GITHUB_FAILURES).map(([code, row]) => ({
  code,
  ...row,
}));

describe("errorToResponse over every GitHub failure the app can raise", () => {
  it.each(githubFailures)(
    "answers $code with $status and the $kind card",
    ({ status, kind, error }) => {
      const response = errorToResponse(error());

      expect(response?.status).toBe(status);
      expect(response?.headers.get("x-review-error")).toBe(kind);
    },
  );

  it.each(githubFailures)(
    "says out loud what went wrong on $code",
    async ({ error }) => {
      const raised = error();

      await expect(errorToResponse(raised)?.text()).resolves.toBe(
        errorToMessage(raised),
      );
    },
  );

  it("keeps the two tables reading the same failure code", () => {
    for (const { code, error } of githubFailures) {
      expect(error().code).toBe(code);
    }
  });
});

describe("errorToMessage outside GitHub's failures", () => {
  it("gives a model failure the generic server-side wording", () => {
    expect(errorToMessage(new Error("ECONNRESET"))).toBe(
      "The review couldn't be completed because of a problem on our end. Please try again later.",
    );
  });

  it("keeps a provider's own words out of the message it shows", () => {
    expect(
      errorToMessage(
        apiError({ statusCode: 429, message: "org quota exceeded" }),
      ),
    ).toBe(TRANSIENT_MESSAGE);
  });

  it("collapses a multi-line GitHub message into one line", () => {
    expect(errorToMessage(new GitHubApiError(502, "Bad\n\n  Gateway"))).toBe(
      "GitHub API error (502): Bad Gateway",
    );
  });
});

describe("verdictMessage", () => {
  it("leaves a verdict that carries no retry hint untouched", () => {
    expect(
      verdictMessage({ hop: true, reason: "server", message: "Busy." }),
    ).toBe("Busy.");
  });

  it("passes the provider's own wait on to the reader", () => {
    expect(
      verdictMessage({
        hop: true,
        reason: "rate-limit",
        message: "Busy.",
        retryAfterSec: 45,
      }),
    ).toContain("45s");

    expect(
      verdictMessage({
        hop: true,
        reason: "rate-limit",
        message: "Busy.",
        retryAfterSec: 120,
      }),
    ).toContain("2 min");
  });
});
