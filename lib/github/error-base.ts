export abstract class GitHubError extends Error {
  abstract readonly code: string;
}
