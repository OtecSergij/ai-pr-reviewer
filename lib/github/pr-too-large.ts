import { GitHubError } from "./error-base";

export class PRTooLargeError extends GitHubError {
  readonly code = "PR_TOO_LARGE";
  constructor(
    public readonly changedFiles: number,
    public readonly limit: number,
  ) {
    super(
      `PR has ${changedFiles} changed files, exceeds limit of ${limit}`,
    );
  }
}
