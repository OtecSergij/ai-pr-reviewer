import { describe, it, expect } from "vitest";
import { APICallError, RetryError } from "ai";
import { classifyFailure } from "./errors";

const INVALID_KEY_MESSAGE = "The API key you entered is invalid.";
const NO_ACCESS_MESSAGE =
  "Your API key doesn't have access to this model, or its quota is exhausted.";
const REVIEW_UNAVAILABLE_MESSAGE =
  "The review service is temporarily unavailable. Please try again later.";
const TOO_LARGE_MESSAGE = "This PR is too large to review.";

function apiError(opts: {
  statusCode?: number;
  responseBody?: string;
  isRetryable?: boolean;
  message?: string;
}): APICallError {
  return new APICallError({
    message: opts.message ?? "api error",
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode: opts.statusCode,
    responseBody: opts.responseBody,
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
  it("maps 404 to an unavailable model", () => {
    expect(classifyFailure(apiError({ statusCode: 404 }))).toMatchObject({
      hop: true,
      reason: "unavailable",
    });
  });

  it("maps context-overflow response bodies to too-large", () => {
    expect(
      classifyFailure(
        apiError({
          statusCode: 400,
          responseBody: "This model's maximum context length is 200000 tokens",
        }),
      ),
    ).toEqual({ hop: true, reason: "too-large", message: TOO_LARGE_MESSAGE });
  });

  it("prioritizes context-overflow detection over generic status handling", () => {
    expect(
      classifyFailure(apiError({ statusCode: 429, responseBody: "input is too large" })),
    ).toMatchObject({ hop: true, reason: "too-large" });
  });

  it("maps 413 to too-large", () => {
    expect(classifyFailure(apiError({ statusCode: 413 }))).toMatchObject({
      hop: true,
      reason: "too-large",
    });
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

describe("classifyFailure non-API errors", () => {
  it("maps a plain error to unknown", () => {
    expect(classifyFailure(new Error("boom"))).toMatchObject({
      hop: true,
      reason: "unknown",
    });
  });
});
