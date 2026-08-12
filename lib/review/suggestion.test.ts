import { describe, it, expect } from "vitest";
import { parseSuggestion } from "./suggestion";

describe("parseSuggestion", () => {
  it("treats text without code markers as pure code", () => {
    const text =
      'const ip = parts[1]?.trim() ?? parts[0]?.trim() ?? "unknown";';
    expect(parseSuggestion(text)).toEqual({ kind: "code", text });
  });

  it("keeps multi-line code without markers as pure code", () => {
    const text = "if (!match) {\n  throw new TypeError('bad input');\n}";
    expect(parseSuggestion(text)).toEqual({ kind: "code", text });
  });

  it("extracts the copy target from prose with a single inline span", () => {
    const view = parseSuggestion(
      'Check if parts[1] exists before accessing it: `const ip = parts[1]?.trim() ?? "unknown"`',
    );
    expect(view).toEqual({
      kind: "mixed",
      copyText: 'const ip = parts[1]?.trim() ?? "unknown"',
    });
  });

  it("gives no copy target for prose with several inline spans", () => {
    const view = parseSuggestion(
      "Derive the `switch` from a single `UNITS` table.",
    );
    expect(view).toEqual({ kind: "mixed", copyText: null });
  });

  it("extracts the copy target from prose with a single fenced block", () => {
    const view = parseSuggestion(
      "Guard the match first:\n```js\nif (!match) {\n  throw new TypeError('bad');\n}\n```",
    );
    expect(view).toEqual({
      kind: "mixed",
      copyText: "if (!match) {\n  throw new TypeError('bad');\n}",
    });
  });

  it("prefers the fenced block over inline spans", () => {
    const view = parseSuggestion(
      "Wrap `match` in a guard:\n```js\nif (!match) return null;\n```\nand keep `parse` unchanged.",
    );
    expect(view).toEqual({
      kind: "mixed",
      copyText: "if (!match) return null;",
    });
  });

  it("gives no copy target for several fenced blocks", () => {
    const view = parseSuggestion(
      "Before:\n```js\nfoo();\n```\nAfter:\n```js\nbar();\n```",
    );
    expect(view).toEqual({ kind: "mixed", copyText: null });
  });

  it("supports tilde fences", () => {
    const view = parseSuggestion("Use:\n~~~\nfoo();\n~~~");
    expect(view).toEqual({ kind: "mixed", copyText: "foo();" });
  });
});
