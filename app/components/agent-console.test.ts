import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TranscriptEntry } from "@/lib/review/transcript";
import { AgentConsole, stripBoldMarkers } from "./agent-console";

describe("stripBoldMarkers removes a pair the way markdown writes one", () => {
  it("unwraps a bold line", () => {
    expect(stripBoldMarkers("**Initiating Review Workflow**")).toBe(
      "Initiating Review Workflow",
    );
  });

  it("unwraps a pair inside a sentence", () => {
    expect(stripBoldMarkers("**bold** in the middle")).toBe(
      "bold in the middle",
    );
  });

  it("unwraps every pair on the line", () => {
    expect(stripBoldMarkers("**one** then **two** then **three**")).toBe(
      "one then two then three",
    );
  });

  it("unwraps a pair that spans a newline", () => {
    expect(stripBoldMarkers("**first\nsecond**")).toBe("first\nsecond");
  });
});

describe("stripBoldMarkers leaves asterisks that are not a pair", () => {
  it("keeps a glob pattern verbatim", () => {
    expect(stripBoldMarkers("**/*.test.ts")).toBe("**/*.test.ts");
  });

  it("keeps two globs on one line verbatim", () => {
    expect(stripBoldMarkers("read **/*.test.ts and **/*.spec.ts")).toBe(
      "read **/*.test.ts and **/*.spec.ts",
    );
  });

  it("keeps a python power expression", () => {
    expect(stripBoldMarkers("a**b")).toBe("a**b");
  });

  it("keeps an unclosed marker", () => {
    expect(stripBoldMarkers("**bold that never closes")).toBe(
      "**bold that never closes",
    );
  });

  it("keeps markers padded with spaces", () => {
    expect(stripBoldMarkers("** not bold **")).toBe("** not bold **");
  });

  it("keeps a glob that follows a real pair", () => {
    expect(stripBoldMarkers("**Plan**: read **/*.test.ts")).toBe(
      "Plan: read **/*.test.ts",
    );
  });

  it("keeps a glob that precedes a real pair on the same line", () => {
    expect(stripBoldMarkers("checked **/*.test.ts and **found** nothing")).toBe(
      "checked **/*.test.ts and found nothing",
    );
  });
});

const consoleMarkup = (transcript: TranscriptEntry[]): string =>
  renderToStaticMarkup(createElement(AgentConsole, { transcript }));

describe("AgentConsole strips bold on both text channels", () => {
  const markup = consoleMarkup([
    { kind: "reasoning", text: "**Plan**: read the tests" },
    { kind: "text", text: "checked **/*.test.ts and **found** nothing" },
  ]);

  it("unwraps the pair a reasoning line carries", () => {
    expect(markup).toContain("Plan: read the tests");
    expect(markup).not.toContain("**Plan**");
  });

  it("unwraps the pair a text line carries", () => {
    expect(markup).toContain("and found nothing");
    expect(markup).not.toContain("**found**");
  });

  it("prints the glob a text line carries verbatim", () => {
    expect(markup).toContain("checked **/*.test.ts and");
  });
});
