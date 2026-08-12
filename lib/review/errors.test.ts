import { describe, it, expect } from "vitest";
import { APICallError, RetryError } from "ai";
import {
  classifyFailure,
  errorKindForReason,
  errorToMessage,
  errorToResponse,
  shownVerdict,
  OUTPUT_TRUNCATED_VERDICT,
  STEPS_EXHAUSTED_VERDICT,
} from "./errors";
import {
  GitHubApiError,
  NotFoundError,
  SecondaryRateLimitError,
  UnauthorizedError,
} from "@/lib/github/octokit/errors";

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
    expect(classifyFailure(apiError({ statusCode: 401 }), { userKey: true })).toEqual({
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
    expect(classifyFailure(apiError({ statusCode: 403 }), { userKey: true })).toEqual({
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

  it("leaves the remaining reasons on the review card", () => {
    for (const reason of [
      "overloaded",
      "server",
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
    ).toBe("rate-limit");
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
