import { describe, it, expect } from "vitest";
import { RequestError } from "@octokit/request-error";
import {
  translateOctokitError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  SecondaryRateLimitError,
  GitHubApiError,
} from "./errors";
import { GitHubError } from "../error-base";

function requestError(
  status: number,
  opts: { headers?: Record<string, string>; message?: string } = {},
): RequestError {
  const url = "https://api.github.com/repos/o/r/pulls/1";
  return new RequestError(opts.message ?? `HTTP ${status}`, status, {
    request: { method: "GET", url, headers: {} },
    response: {
      status,
      url,
      headers: opts.headers ?? {},
      data: { message: opts.message },
    },
  });
}

describe("translateOctokitError passthrough", () => {
  it("rethrows a GitHubError unchanged", () => {
    const original = new NotFoundError("pr");
    expect(() => translateOctokitError(original, "x")).toThrow(original);
  });

  it("rethrows a non-RequestError unchanged", () => {
    const original = new TypeError("boom");
    expect(() => translateOctokitError(original, "x")).toThrow(original);
  });
});

describe("translateOctokitError status mapping", () => {
  it("maps 401 to UnauthorizedError", () => {
    expect(() => translateOctokitError(requestError(401), "pr")).toThrow(
      UnauthorizedError,
    );
  });

  it("maps 404 to NotFoundError carrying the resource", () => {
    try {
      translateOctokitError(requestError(404), "pull #7");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).resource).toBe("pull #7");
      expect((err as NotFoundError).code).toBe("NOT_FOUND");
    }
  });

  it("maps a secondary-rate-limit body to SecondaryRateLimitError(60)", () => {
    try {
      translateOctokitError(
        requestError(403, { message: "You have exceeded a secondary rate limit" }),
        "pr",
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SecondaryRateLimitError);
      expect((err as SecondaryRateLimitError).retryAfterSeconds).toBe(60);
    }
  });

  it("uses the retry-after header for SecondaryRateLimitError", () => {
    try {
      translateOctokitError(requestError(429, { headers: { "retry-after": "30" } }), "pr");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SecondaryRateLimitError);
      expect((err as SecondaryRateLimitError).retryAfterSeconds).toBe(30);
    }
  });

  it("falls back to 60s when retry-after is not a positive number", () => {
    try {
      translateOctokitError(requestError(403, { headers: { "retry-after": "0" } }), "pr");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SecondaryRateLimitError);
      expect((err as SecondaryRateLimitError).retryAfterSeconds).toBe(60);
    }
  });

  it("maps exhausted primary rate limit to RateLimitError with resetAt", () => {
    try {
      translateOctokitError(
        requestError(403, {
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1700000000",
          },
        }),
        "pr",
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).resetAt.getTime()).toBe(1700000000 * 1000);
    }
  });

  it("maps other 403 responses to ForbiddenError carrying the body message", () => {
    try {
      translateOctokitError(requestError(403, { message: "Resource protected" }), "pr");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).detail).toBe("Resource protected");
    }
  });

  it("maps an unclassified status to GitHubApiError", () => {
    try {
      translateOctokitError(requestError(502, { message: "bad gateway" }), "pr");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubApiError);
      expect((err as GitHubApiError).status).toBe(502);
    }
  });
});

describe("translateOctokitError retry-after regression (#36)", () => {
  it("does not treat a 5xx with retry-after as a secondary rate limit", () => {
    try {
      translateOctokitError(
        requestError(500, {
          headers: { "retry-after": "30" },
          message: "internal error",
        }),
        "pr",
      );
      expect.unreachable();
    } catch (err) {
      expect(err).not.toBeInstanceOf(SecondaryRateLimitError);
      expect(err).toBeInstanceOf(GitHubApiError);
      expect((err as GitHubApiError).status).toBe(500);
    }
  });

  it("still produces a GitHubError for the 5xx case", () => {
    try {
      translateOctokitError(requestError(503, { headers: { "retry-after": "5" } }), "pr");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubError);
    }
  });
});
