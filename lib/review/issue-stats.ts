import type { Issue } from "@/lib/review/issue";

export function countBySeverity(
  issues: Issue[]
): Map<Issue["severity"], number> {
  const counts = new Map<Issue["severity"], number>();
  for (const issue of issues) {
    counts.set(issue.severity, (counts.get(issue.severity) ?? 0) + 1);
  }
  return counts;
}
