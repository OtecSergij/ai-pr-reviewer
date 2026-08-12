import { describe, it, expect } from "vitest";
import { issueLanguage, normalizeSuggestion } from "./enrich-issue";

describe("issueLanguage reads the extension off the file name", () => {
  it("names an extensionless file in a subdirectory after the file", () => {
    expect(issueLanguage("docker/Dockerfile")).toBe("Dockerfile");
  });

  it("survives a dot in a parent directory", () => {
    expect(issueLanguage("a.b/Dockerfile")).toBe("Dockerfile");
  });

  it("keeps reading ordinary paths as before", () => {
    expect(issueLanguage("src/review/index.ts")).toBe("ts");
    expect(issueLanguage(".gitignore")).toBe("gitignore");
  });

  it("falls back to text when there is nothing to read", () => {
    expect(issueLanguage("")).toBe("text");
  });
});

describe("normalizeSuggestion unwraps a fenced snippet", () => {
  it("strips a fence with a js info string", () => {
    expect(
      normalizeSuggestion("```js\nif (!match) {\n  throw new Error();\n}\n```")
    ).toBe("if (!match) {\n  throw new Error();\n}");
  });

  it("strips a fence without an info string", () => {
    expect(normalizeSuggestion("```\nconst a = 1;\n```")).toBe("const a = 1;");
  });

  it("strips a fence surrounded by whitespace and a trailing newline", () => {
    expect(normalizeSuggestion("\n```ts\nconst a: number = 1;\n```\n\n")).toBe(
      "const a: number = 1;"
    );
  });

  it("keeps a blank line that precedes the closing fence", () => {
    expect(normalizeSuggestion("```tsx\n<Foo />\n\n```")).toBe("<Foo />\n");
  });

  it("strips a tilde fence", () => {
    expect(normalizeSuggestion("~~~python\nprint(1)\n~~~")).toBe("print(1)");
  });

  it("accepts a closing fence longer than the opening one", () => {
    expect(normalizeSuggestion("```js\nconst a = 1;\n`````")).toBe(
      "const a = 1;"
    );
  });

  it("preserves inner indentation and inner blank lines", () => {
    const inner =
      "function f() {\n  const a = 1;\n\n  if (a) {\n    return a;\n  }\n}";
    expect(normalizeSuggestion("```js\n" + inner + "\n```")).toBe(inner);
  });

  it("keeps an inner fence when the outer fence is longer", () => {
    expect(normalizeSuggestion("````md\n```js\nconst a = 1;\n```\n````")).toBe(
      "```js\nconst a = 1;\n```"
    );
  });
});

describe("normalizeSuggestion leaves unfenced text alone", () => {
  it("returns prose unchanged", () => {
    const prose =
      "Derive the `switch` from a single `UNITS` table so the two cannot disagree.";
    expect(normalizeSuggestion(prose)).toBe(prose);
  });

  it("returns an unterminated opening fence unchanged", () => {
    const text = "```js\nconst a = 1;";
    expect(normalizeSuggestion(text)).toBe(text);
  });

  it("returns a lone fence line unchanged", () => {
    expect(normalizeSuggestion("```js")).toBe("```js");
  });

  it("leaves a fence that starts mid-text untouched", () => {
    const text = "Use a lookup table instead:\n\n```js\nconst a = 1;\n```";
    expect(normalizeSuggestion(text)).toBe(text);
  });

  it("leaves two consecutive fenced blocks untouched", () => {
    const text = "```js\nconst a = 1;\n```\n\n```js\nconst b = 2;\n```";
    expect(normalizeSuggestion(text)).toBe(text);
  });

  it("leaves text that only ends with a fence untouched", () => {
    const text = "const a = 1;\n```";
    expect(normalizeSuggestion(text)).toBe(text);
  });
});

describe("normalizeSuggestion normalizes escapes before unwrapping", () => {
  it("unwraps a fence that appears only after escaped newlines are decoded", () => {
    expect(normalizeSuggestion("```js\\nconst a = 1;\\n```")).toBe(
      "const a = 1;"
    );
  });

  it("decodes escaped tabs inside the unwrapped snippet", () => {
    expect(normalizeSuggestion("```js\\nif (a) {\\n\\treturn a;\\n}\\n```")).toBe(
      "if (a) {\n  return a;\n}"
    );
  });

  it("decodes escaped carriage returns before unwrapping", () => {
    expect(normalizeSuggestion("```js\\r\\nconst a = 1;\\r\\n```")).toBe(
      "const a = 1;"
    );
  });

  it("still normalizes escapes in prose it leaves unchanged", () => {
    expect(normalizeSuggestion("Rename the flag.\\nThen update the docs.")).toBe(
      "Rename the flag.\nThen update the docs."
    );
  });
});
