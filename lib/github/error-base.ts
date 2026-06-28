export type GitHubErrorCode =
  | "INVALID_PR_URL"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMIT"
  | "SECONDARY_RATE_LIMIT"
  | "GITHUB_API_ERROR";

export abstract class GitHubError extends Error {
  abstract readonly code: GitHubErrorCode;
}
