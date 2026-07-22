import { GitHubError } from "./error-base";

export type PRRef = {
  owner: string;
  repo: string;
  prNumber: number;
};

export class InvalidPRUrl extends GitHubError {
  readonly code = "INVALID_PR_URL";
  constructor(
    public readonly reason: string,
    public readonly input: string,
  ) {
    super(`Invalid PR URL (${reason}): ${input}`);
  }
}

export function parsePRUrl(input: string): PRRef {
  const trimmed = input.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidPRUrl("not a valid URL", input);
  }

  const hostname = url.hostname.replace(/^www\./, "");
  if (hostname !== "github.com") {
    throw new InvalidPRUrl(
      `expected host github.com, got ${url.hostname}`,
      input,
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 4 || segments[2] !== "pull") {
    throw new InvalidPRUrl(
      "expected path /<owner>/<repo>/pull/<number>",
      input,
    );
  }

  const [owner, repo, , numberStr] = segments;
  if (!owner || !repo) {
    throw new InvalidPRUrl("missing owner or repo", input);
  }

  if (!/^\d+$/.test(numberStr)) {
    throw new InvalidPRUrl(`invalid PR number: ${numberStr}`, input);
  }

  const prNumber = Number(numberStr);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new InvalidPRUrl(`invalid PR number: ${numberStr}`, input);
  }

  return { owner, repo, prNumber };
}
