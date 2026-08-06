export type SuggestionView =
  | { kind: "code"; text: string }
  | { kind: "mixed"; copyText: string | null };

const FENCE_RE =
  /(?:^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*(?=\n|$)/g;

const SPAN_RE = /`([^`\n]+)`/g;

export function parseSuggestion(text: string): SuggestionView {
  const fences: string[] = [];
  const rest = text.replace(FENCE_RE, (_match, _fence, code: string) => {
    fences.push(code);
    return "\n";
  });
  const spans = [...rest.matchAll(SPAN_RE)].map((m) => m[1]);

  if (fences.length === 0 && spans.length === 0) {
    return { kind: "code", text };
  }

  const copyText =
    fences.length === 1
      ? fences[0]
      : fences.length === 0 && spans.length === 1
      ? spans[0]
      : null;

  return { kind: "mixed", copyText };
}
