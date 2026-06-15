import type { ModelIssue } from "@/lib/ai/schema/review-stream";

export type CodeLineKind = "added" | "removed" | "context";

export type CodeLine = {
  lineno: number | null;
  content: string;
  kind: CodeLineKind;
  target: boolean;
};

export type IssueData = {
  id: string;
  severity: ModelIssue["severity"];
  title: string;
  body: string;
  suggestion?: string;
  file: string;
  line_start: number;
  line_end: number;
  blob_url: string;
  language: string;
  code_lines: CodeLine[];
};
