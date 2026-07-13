import type { CodeLineKind, Issue } from "@/lib/review/issue";
import type { PRFileStatus } from "@/lib/review/stream";

type SeverityStyle = {
  label: string;
  plural: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
};

export const TONE = {
  success: { bg: "#dafbe1", fg: "#1a7f37" },
  warning: { bg: "#fff8c5", fg: "#9a6700" },
  danger: { bg: "#ffebe9", fg: "#cf222e" },
  info: { bg: "#eef2ff", fg: "#4338ca" },
} as const;

export const SEVERITY_STYLES: Record<Issue["severity"], SeverityStyle> = {
  error: {
    label: "Error",
    plural: "errors",
    color: TONE.danger.fg,
    bg: TONE.danger.bg,
    border: "#ffd1ce",
    dot: "#cf222e",
  },
  warning: {
    label: "Warning",
    plural: "warnings",
    color: TONE.warning.fg,
    bg: TONE.warning.bg,
    border: "#f0e0a0",
    dot: "#d4a72c",
  },
  nit: {
    label: "Nit",
    plural: "nits",
    color: "#475569",
    bg: "#f1f5f9",
    border: "#e2e8f0",
    dot: "#94a3b8",
  },
  suggestion: {
    label: "Suggestion",
    plural: "suggestions",
    color: TONE.success.fg,
    bg: TONE.success.bg,
    border: "#bce8c8",
    dot: "#2da44e",
  },
};

export const SEVERITY_ORDER: ReadonlyArray<Issue["severity"]> = [
  "error",
  "warning",
  "nit",
  "suggestion",
];

type CodeLineStyle = { bg: string; sign: string; signColor: string };

export const CODE_LINE_STYLES: Record<CodeLineKind, CodeLineStyle> = {
  added: { bg: "#e6ffec", sign: "+", signColor: "#1a7f37" },
  removed: { bg: "#ffebe9", sign: "−", signColor: "#cf222e" },
  context: { bg: "#ffffff", sign: "", signColor: "#8c959f" },
};

export const TARGET_ACCENT = "#f59e0b";

type FileStatusStyle = { char: string; color: string; bg: string };

export const FILE_STATUS_STYLES: Record<PRFileStatus, FileStatusStyle> = {
  added: { char: "A", color: "#1a7f37", bg: "#dafbe1" },
  removed: { char: "D", color: "#cf222e", bg: "#ffebe9" },
  modified: { char: "M", color: "#9a6700", bg: "#fff8c5" },
  renamed: { char: "R", color: "#9a6700", bg: "#fff8c5" },
  copied: { char: "C", color: "#9a6700", bg: "#fff8c5" },
  changed: { char: "M", color: "#9a6700", bg: "#fff8c5" },
  unchanged: { char: "U", color: "#57606a", bg: "#f1f5f9" },
};
