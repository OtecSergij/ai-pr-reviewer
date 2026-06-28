import "server-only";
import { RetryError, APICallError } from "ai";
import { GitHubError, type GitHubErrorCode } from "@/lib/github/error-base";

const TRANSIENT_MESSAGE =
  "The review service is busy right now. Please try again in a moment.";
const SERVER_SIDE_MESSAGE =
  "The review couldn't be completed because of a problem on our end. Please try again later.";

export function errorToMessage(error: unknown): string {
  if (error instanceof GitHubError) return error.message;

  if (RetryError.isInstance(error)) {
    if (error.reason === "maxRetriesExceeded") return TRANSIENT_MESSAGE;
    return errorToMessage(error.lastError);
  }

  if (APICallError.isInstance(error) && error.isRetryable)
    return TRANSIENT_MESSAGE;

  return SERVER_SIDE_MESSAGE;
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
