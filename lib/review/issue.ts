import type { ModelIssue } from "./model-issue.schema";

export type CodeLineKind = "added" | "removed" | "context";

export type CodeLine = {
  lineno: number | null;
  content: string;
  kind: CodeLineKind;
  target: boolean;
};

export type Issue = {
  id: string;
  severity: ModelIssue["severity"];
  title: string;
  body: string;
  suggestion?: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  blobUrl: string;
  language: string;
  codeLines: CodeLine[];
};
