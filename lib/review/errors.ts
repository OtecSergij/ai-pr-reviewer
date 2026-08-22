import "server-only";
import { RetryError, APICallError } from "ai";
import { GitHubError, type GitHubErrorCode } from "@/lib/github/error-base";
import { isTtfbTimeout } from "@/lib/ai/provider-fetch";
import type { ProviderName } from "@/lib/ai/provider";
import type { ErrorKind } from "@/lib/review/transcript";

const TRANSIENT_MESSAGE =
  "The review service is busy right now. Please try again in a moment.";
const SERVER_SIDE_MESSAGE =
  "The review couldn't be completed because of a problem on our end. Please try again later.";
const INVALID_KEY_MESSAGE = "The API key you entered is invalid.";
const NO_ACCESS_MESSAGE =
  "The API key you entered doesn't have access to this model.";
const REVIEW_UNAVAILABLE_MESSAGE =
  "The review service is temporarily unavailable. Please try again later.";
const MODEL_UNAVAILABLE_MESSAGE = "The selected model isn't available.";
const TOO_LARGE_MESSAGE =
  "The diff is too large for the model's context window.";
const CUT_SHORT_MESSAGE =
  "The review was cut short before it finished. Please try again.";
const TIMEOUT_MESSAGE =
  "The review service took too long to respond. Please try again.";
const OVER_BUDGET_MESSAGE =
  "This review grew past what the free providers accept in a single request. Please try again, or review a smaller pull request.";

const MAX_USER_MESSAGE_CHARS = 240;

export type FailureReason =
  | "rate-limit"
  | "provider-limit"
  | "over-budget"
  | "overloaded"
  | "server"
  | "timeout"
  | "context-overflow"
  | "output-truncated"
  | "steps-exhausted"
  | "unavailable"
  | "auth"
  | "key-rejected"
  | "aborted"
  | "unknown";

export type FailureVerdict = {
  hop: boolean;
  reason: FailureReason;
  message: string;
  provider?: ProviderName;
  modelId?: string;
  retryAfterSec?: number;
};

const CONTEXT_OVERFLOW_MARKERS = [
  "context length",
  "context window",
  "maximum context",
  "context_length_exceeded",
  "maximum number of tokens",
  "prompt is too long",
  "messages are too long",
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

function usableSeconds(seconds: number): number | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.ceil(seconds);
}

function retryAfterHeader(error: APICallError): number | undefined {
  const raw = error.responseHeaders?.["retry-after"];
  if (raw === undefined) return undefined;
  return usableSeconds(Number(raw.trim()));
}

function retryInfoDetails(parsed: unknown): unknown[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const root = parsed as { error?: unknown; details?: unknown };
  const nested =
    typeof root.error === "object" && root.error !== null
      ? (root.error as { details?: unknown }).details
      : undefined;
  const details = Array.isArray(nested) ? nested : root.details;
  return Array.isArray(details) ? details : [];
}

function retryDelayOf(detail: unknown): number | undefined {
  if (typeof detail !== "object" || detail === null) return undefined;
  const record = detail as Record<string, unknown>;
  if (!String(record["@type"] ?? "").includes("RetryInfo")) return undefined;

  const delay = record.retryDelay;

  if (typeof delay === "string")
    return usableSeconds(Number(delay.trim().replace(/s$/, "")));

  if (typeof delay === "object" && delay !== null) {
    const { seconds, nanos } = delay as { seconds?: unknown; nanos?: unknown };
    return usableSeconds(Number(seconds ?? 0) + Number(nanos ?? 0) / 1e9);
  }

  return undefined;
}

function retryAfterBody(error: APICallError): number | undefined {
  if (!error.responseBody) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(error.responseBody);
  } catch {
    return undefined;
  }

  for (const detail of retryInfoDetails(parsed)) {
    const seconds = retryDelayOf(detail);
    if (seconds !== undefined) return seconds;
  }

  return undefined;
}

function retryAfter(error: APICallError): { retryAfterSec?: number } {
  const retryAfterSec = retryAfterHeader(error) ?? retryAfterBody(error);
  return retryAfterSec === undefined ? {} : { retryAfterSec };
}

function classifyApiError(
  error: APICallError,
  userKey: boolean,
): FailureVerdict {
  const status = error.statusCode;

  if (isTtfbTimeout(error))
    return { hop: true, reason: "timeout", message: TIMEOUT_MESSAGE };
  if (status === 401)
    return userKey
      ? { hop: false, reason: "key-rejected", message: INVALID_KEY_MESSAGE }
      : { hop: true, reason: "auth", message: REVIEW_UNAVAILABLE_MESSAGE };
  if (status === 403)
    return userKey
      ? { hop: false, reason: "key-rejected", message: NO_ACCESS_MESSAGE }
      : { hop: true, reason: "auth", message: REVIEW_UNAVAILABLE_MESSAGE };
  if (status === 404)
    return {
      hop: true,
      reason: "unavailable",
      message: userKey ? MODEL_UNAVAILABLE_MESSAGE : REVIEW_UNAVAILABLE_MESSAGE,
    };
  if (status === 413)
    return {
      hop: true,
      reason: "provider-limit",
      message: TRANSIENT_MESSAGE,
      ...retryAfter(error),
    };
  if (status === 429)
    return {
      hop: true,
      reason: "rate-limit",
      message: TRANSIENT_MESSAGE,
      ...retryAfter(error),
    };
  if (status === 529)
    return {
      hop: true,
      reason: "overloaded",
      message: TRANSIENT_MESSAGE,
      ...retryAfter(error),
    };
  if (error.isRetryable)
    return { hop: true, reason: "server", message: TRANSIENT_MESSAGE };
  if (isContextOverflow(error))
    return {
      hop: true,
      reason: "context-overflow",
      message: TOO_LARGE_MESSAGE,
    };

  return { hop: true, reason: "unknown", message: SERVER_SIDE_MESSAGE };
}

export function classifyFailure(
  error: unknown,
  opts?: { userKey?: boolean; signal?: AbortSignal },
): FailureVerdict {
  if (isAbort(error))
    return (opts?.signal?.aborted ?? true)
      ? { hop: false, reason: "aborted", message: SERVER_SIDE_MESSAGE }
      : { hop: true, reason: "server", message: TRANSIENT_MESSAGE };

  if (RetryError.isInstance(error))
    return classifyFailure(error.lastError, opts);

  if (APICallError.isInstance(error))
    return classifyApiError(error, opts?.userKey ?? false);

  return { hop: true, reason: "unknown", message: SERVER_SIDE_MESSAGE };
}

export const OUTPUT_TRUNCATED_VERDICT: FailureVerdict = {
  hop: true,
  reason: "output-truncated",
  message: CUT_SHORT_MESSAGE,
};

export const STEPS_EXHAUSTED_VERDICT: FailureVerdict = {
  hop: true,
  reason: "steps-exhausted",
  message: CUT_SHORT_MESSAGE,
};

export const OVER_BUDGET_VERDICT: FailureVerdict = {
  hop: true,
  reason: "over-budget",
  message: OVER_BUDGET_MESSAGE,
};

export function shownVerdict(
  verdicts: readonly FailureVerdict[],
): FailureVerdict {
  const last = verdicts.at(-1);
  if (!last)
    return { hop: true, reason: "unknown", message: SERVER_SIDE_MESSAGE };
  if (last.reason !== "unknown") return last;

  for (let i = verdicts.length - 2; i >= 0; i--) {
    const earlier = verdicts[i];
    if (earlier.reason !== "unknown") return earlier;
  }

  return last;
}

const KIND_BY_REASON: Record<FailureReason, ErrorKind> = {
  "rate-limit": "provider-quota",
  "provider-limit": "provider-quota",
  "over-budget": "provider-quota",
  overloaded: "review",
  server: "review",
  timeout: "review",
  "context-overflow": "too-many-files",
  "output-truncated": "review",
  "steps-exhausted": "review",
  unavailable: "review",
  auth: "review",
  "key-rejected": "api-key",
  aborted: "review",
  unknown: "review",
};

export function errorKindForReason(reason: FailureReason): ErrorKind {
  return KIND_BY_REASON[reason];
}

function retryHint(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)} min`;
}

export function verdictMessage(verdict: FailureVerdict): string {
  if (verdict.retryAfterSec === undefined) return verdict.message;
  return `${verdict.message} The provider asked for about ${retryHint(verdict.retryAfterSec)} before the next attempt.`;
}

function forUser(message: string): string {
  const collapsed = message.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_USER_MESSAGE_CHARS) return collapsed;
  return `${collapsed.slice(0, MAX_USER_MESSAGE_CHARS).trimEnd()}…`;
}

export function errorToMessage(error: unknown): string {
  if (error instanceof GitHubError) return forUser(error.message);
  return classifyFailure(error).message;
}

const STATUS_BY_GITHUB_CODE: Record<GitHubErrorCode, number> = {
  INVALID_PR_URL: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMIT: 429,
  SECONDARY_RATE_LIMIT: 429,
  TIMEOUT: 504,
  GITHUB_API_ERROR: 502,
};

const KIND_BY_GITHUB_CODE: Record<GitHubErrorCode, ErrorKind> = {
  INVALID_PR_URL: "load",
  UNAUTHORIZED: "load",
  FORBIDDEN: "load",
  NOT_FOUND: "load",
  RATE_LIMIT: "github",
  SECONDARY_RATE_LIMIT: "github",
  TIMEOUT: "github",
  GITHUB_API_ERROR: "github",
};

export function errorToResponse(error: unknown): Response | undefined {
  if (!(error instanceof GitHubError)) return undefined;
  return new Response(errorToMessage(error), {
    status: STATUS_BY_GITHUB_CODE[error.code],
    headers: { "x-review-error": KIND_BY_GITHUB_CODE[error.code] },
  });
}
