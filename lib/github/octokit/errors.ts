import { RequestError } from "@octokit/request-error";
import { GitHubError } from "../error-base";

export class NotFoundError extends GitHubError {
  readonly code = "NOT_FOUND";
  constructor(
    public readonly resource: string,
    options?: { cause?: unknown },
  ) {
    super(
      `Resource not found or inaccessible with current token: ${resource}`,
      options,
    );
  }
}

export class UnauthorizedError extends GitHubError {
  readonly code = "UNAUTHORIZED";
  constructor(options?: { cause?: unknown }) {
    super("GitHub token is invalid or expired", options);
  }
}

export class ForbiddenError extends GitHubError {
  readonly code = "FORBIDDEN";
  constructor(
    public readonly detail: string,
    options?: { cause?: unknown },
  ) {
    super(`Forbidden by GitHub: ${detail}`, options);
  }
}

export class RateLimitError extends GitHubError {
  readonly code = "RATE_LIMIT";
  constructor(
    public readonly resetAt: Date,
    options?: { cause?: unknown },
  ) {
    super(
      `GitHub primary rate limit exceeded; resets at ${resetAt.toISOString()}`,
      options,
    );
  }
}

export class SecondaryRateLimitError extends GitHubError {
  readonly code = "SECONDARY_RATE_LIMIT";
  constructor(
    public readonly retryAfterSeconds: number,
    options?: { cause?: unknown },
  ) {
    super(
      `GitHub secondary rate limit hit; retry after ${retryAfterSeconds}s`,
      options,
    );
  }
}

export class GitHubApiError extends GitHubError {
  readonly code = "GITHUB_API_ERROR";
  constructor(
    public readonly status: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`GitHub API error (${status}): ${message}`, options);
  }
}

export function translateOctokitError(err: unknown, resource: string): never {
  if (err instanceof GitHubError) {
    throw err;
  }
  if (!(err instanceof RequestError)) {
    throw err;
  }

  const { status, response } = err;
  const headers = (response?.headers ?? {}) as Record<string, unknown>;
  const data = response?.data as { message?: string } | undefined;
  const bodyMessage = data?.message ?? err.message;

  if (status === 401) {
    throw new UnauthorizedError({ cause: err });
  }

  if (status === 404) {
    throw new NotFoundError(resource, { cause: err });
  }

  if (status === 403 || status === 429) {
    if (bodyMessage.toLowerCase().includes("secondary rate limit")) {
      throw new SecondaryRateLimitError(60, { cause: err });
    }

    const retryAfter = readHeader(headers, "retry-after");
    if (retryAfter !== undefined) {
      const seconds = parseInt(retryAfter, 10);
      throw new SecondaryRateLimitError(
        Number.isFinite(seconds) && seconds > 0 ? seconds : 60,
        { cause: err },
      );
    }

    const remaining = readHeader(headers, "x-ratelimit-remaining");
    if (remaining === "0") {
      const reset = readHeader(headers, "x-ratelimit-reset");
      const resetSec = reset ? parseInt(reset, 10) : NaN;
      const resetAt = Number.isFinite(resetSec)
        ? new Date(resetSec * 1000)
        : new Date(Date.now() + 60_000);
      throw new RateLimitError(resetAt, { cause: err });
    }

    throw new ForbiddenError(bodyMessage, { cause: err });
  }

  throw new GitHubApiError(status, bodyMessage, { cause: err });
}

function readHeader(
  headers: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = headers[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}
