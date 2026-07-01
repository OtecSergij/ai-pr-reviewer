import "server-only";
import { RetryError, APICallError } from "ai";
import { GitHubError, type GitHubErrorCode } from "@/lib/github/error-base";

const TRANSIENT_MESSAGE =
  "The review service is busy right now. Please try again in a moment.";
const SERVER_SIDE_MESSAGE =
  "The review couldn't be completed because of a problem on our end. Please try again later.";
const INVALID_KEY_MESSAGE = "The API key you entered is invalid.";
const NO_ACCESS_MESSAGE =
  "Your API key doesn't have access to this model, or its quota is exhausted.";
const MODEL_UNAVAILABLE_MESSAGE = "The selected model isn't available.";
const TOO_LARGE_MESSAGE = "This PR is too large to review.";

export type FailureReason =
  | "rate-limit"
  | "overloaded"
  | "server"
  | "too-large"
  | "unavailable"
  | "auth"
  | "aborted"
  | "unknown";

export type FailureVerdict = {
  hop: boolean;
  reason: FailureReason;
  message: string;
};

const CONTEXT_OVERFLOW_MARKERS = [
  "context length",
  "context window",
  "maximum context",
  "context_length_exceeded",
  "maximum number of tokens",
  "too long",
  "reduce the length",
  "input is too large",
];

function isContextOverflow(error: APICallError): boolean {
  const haystack = `${error.message} ${error.responseBody ?? ""}`.toLowerCase();
  return CONTEXT_OVERFLOW_MARKERS.some((marker) => haystack.includes(marker));
}

function isAbort(error: unknown): boolean {
  if (RetryError.isInstance(error) && error.reason === "abort") return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function classifyApiError(error: APICallError): FailureVerdict {
  const status = error.statusCode;

  if (status === 401)
    return { hop: false, reason: "auth", message: INVALID_KEY_MESSAGE };
  if (status === 403)
    return { hop: false, reason: "auth", message: NO_ACCESS_MESSAGE };
  if (status === 404)
    return {
      hop: true,
      reason: "unavailable",
      message: MODEL_UNAVAILABLE_MESSAGE,
    };
  if (isContextOverflow(error))
    return { hop: true, reason: "too-large", message: TOO_LARGE_MESSAGE };
  if (status === 413)
    return { hop: true, reason: "too-large", message: TOO_LARGE_MESSAGE };
  if (status === 429)
    return { hop: true, reason: "rate-limit", message: TRANSIENT_MESSAGE };
  if (status === 529)
    return { hop: true, reason: "overloaded", message: TRANSIENT_MESSAGE };
  if (error.isRetryable)
    return { hop: true, reason: "server", message: TRANSIENT_MESSAGE };

  return { hop: true, reason: "unknown", message: SERVER_SIDE_MESSAGE };
}

export function classifyFailure(error: unknown): FailureVerdict {
  if (isAbort(error))
    return { hop: false, reason: "aborted", message: SERVER_SIDE_MESSAGE };

  if (RetryError.isInstance(error)) return classifyFailure(error.lastError);

  if (APICallError.isInstance(error)) return classifyApiError(error);

  return { hop: true, reason: "unknown", message: SERVER_SIDE_MESSAGE };
}

export function errorToMessage(error: unknown): string {
  if (error instanceof GitHubError) return error.message;
  return classifyFailure(error).message;
}

const STATUS_BY_GITHUB_CODE: Record<GitHubErrorCode, number> = {
  INVALID_PR_URL: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMIT: 429,
  SECONDARY_RATE_LIMIT: 429,
  GITHUB_API_ERROR: 502,
};

export function errorToResponse(error: unknown): Response | undefined {
  if (!(error instanceof GitHubError)) return undefined;
  return new Response(errorToMessage(error), {
    status: STATUS_BY_GITHUB_CODE[error.code],
  });
}
