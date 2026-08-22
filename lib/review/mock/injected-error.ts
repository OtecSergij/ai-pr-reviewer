import { APICallError, LoadAPIKeyError, RetryError } from "ai";
import type { ModelMessage } from "ai";

import { env } from "@/lib/env";
import { isIssueStep } from "@/lib/review/mock/scenario";
import type { MockStep } from "@/lib/review/mock/scenario";

const MOCK_API_URL = "https://mock.provider/v1/messages";
const MID_STREAM_ISSUE_COUNT = 2;
const CONTEXT_OVERFLOW_BODY =
  '{"error":{"message":"prompt is too long: 214000 tokens > 200000 maximum context length"}}';

function apiError({
  message,
  statusCode,
  isRetryable = false,
  responseBody,
  responseHeaders,
}: {
  message: string;
  statusCode: number;
  isRetryable?: boolean;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
}): APICallError {
  return new APICallError({
    message,
    url: MOCK_API_URL,
    requestBodyValues: {},
    statusCode,
    isRetryable,
    responseBody,
    responseHeaders,
  });
}

function serviceUnavailable(): APICallError {
  return apiError({
    message: "Service Unavailable",
    statusCode: 503,
    isRetryable: true,
  });
}

export function injectedStartError(): unknown {
  switch (env.MOCK_ERROR) {
    case "api-retryable":
      return serviceUnavailable();
    case "retry-exhausted":
      return new RetryError({
        message: "Failed after maximum retries",
        reason: "maxRetriesExceeded",
        errors: [serviceUnavailable()],
      });
    case "api-400":
      return apiError({ message: "Bad Request", statusCode: 400 });
    case "api-401":
      return apiError({ message: "Unauthorized", statusCode: 401 });
    case "api-402":
      return apiError({ message: "Payment Required", statusCode: 402 });
    case "api-403":
      return apiError({ message: "Forbidden", statusCode: 403 });
    case "api-404":
      return apiError({ message: "Not Found", statusCode: 404 });
    case "api-413":
      return apiError({ message: "Payload Too Large", statusCode: 413 });
    case "api-429":
      return apiError({
        message: "Too Many Requests",
        statusCode: 429,
        isRetryable: true,
        responseHeaders: { "retry-after": "30" },
      });
    case "context-overflow":
      return apiError({
        message: "Bad Request",
        statusCode: 400,
        responseBody: CONTEXT_OVERFLOW_BODY,
      });
    case "abort":
      return new RetryError({
        message: "Aborted",
        reason: "abort",
        errors: [new DOMException("The operation was aborted.", "AbortError")],
      });
    case "load-key":
      return new LoadAPIKeyError({ message: "API key is missing" });
    case "unknown":
      return new Error("Something unexpected blew up");
    default:
      return undefined;
  }
}

export function injectedStreamError(): APICallError {
  return serviceUnavailable();
}

export function streamErrorStopIndex(
  steps: MockStep[],
  messages: ModelMessage[] | undefined,
): number | null {
  if (env.MOCK_ERROR === "mid-stream") return midStreamStopIndex(steps);

  if (env.MOCK_ERROR === "first-only" && isFirstAttempt(messages)) {
    return steps.findIndex((step) => step.kind === "tool");
  }

  return null;
}

function isFirstAttempt(messages: ModelMessage[] | undefined): boolean {
  return (messages ?? []).every((message) => message.role === "user");
}

function midStreamStopIndex(steps: MockStep[]): number {
  const issueIndexes = steps.flatMap((step, index) =>
    isIssueStep(step) ? [index] : [],
  );

  return (
    issueIndexes[MID_STREAM_ISSUE_COUNT - 1] ??
    issueIndexes[issueIndexes.length - 1] ??
    steps.length - 1
  );
}
