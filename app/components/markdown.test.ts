import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, MarkdownInline } from "./markdown";

const block = (source: string): string =>
  renderToStaticMarkup(createElement(Markdown, null, source));

const inline = (source: string): string =>
  renderToStaticMarkup(createElement(MarkdownInline, null, source));

describe("Markdown keeps the classes rehype puts on a node", () => {
  it("leaves the footnote label visually hidden", () => {
    const html = block("Claim.[^1]\n\n[^1]: Source.");

    expect(html).toContain('id="footnote-label"');
    expect(html).toMatch(/<h5[^>]*class="[^"]*sr-only[^"]*"[^>]*>Footnotes<\/h5>/);
  });

  it("still styles a heading that carries no class of its own", () => {
    expect(block("### Title")).toContain("font-semibold");
  });
});

describe("Markdown renders an empty fence as a block", () => {
  it("drops the inline pill background", () => {
    const html = block("```\n```");

    expect(html).toContain("<pre");
    expect(html).toContain('<code class="font-mono">');
  });

  it("keeps a genuine inline snippet as a pill", () => {
    expect(inline("use `foo` here")).toContain("rounded-[5px]");
  });
});

describe("MarkdownInline matches the block pipeline on gfm", () => {
  it("renders strikethrough", () => {
    expect(inline("~~gone~~")).toContain("<del");
  });

  it("linkifies a bare url and hardens the anchor", () => {
    const html = inline("see https://example.com now");

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });
});

describe("MarkdownInline emits no block-level elements", () => {
  it("unwraps a list that an ordered-looking title creates", () => {
    const html = inline("1. foo");

    expect(html).not.toContain("<ol");
    expect(html).not.toContain("<li");
    expect(html).toContain("foo");
  });

  it("leaves a decimal that starts a title alone", () => {
    expect(inline("1.5x slower on every request")).toBe(
      "1.5x slower on every request"
    );
  });

  it("unwraps a heading", () => {
    const html = inline("# Heading");

    expect(html).not.toContain("<h1");
    expect(html).toContain("Heading");
  });

  it("keeps inline emphasis while unwrapping its block parent", () => {
    const html = inline("> **bold** quote");

    expect(html).not.toContain("<blockquote");
    expect(html).toContain('<strong class="font-semibold">bold</strong> quote');
  });
});

describe("MarkdownInline drops what it unwraps, and that is the trade", () => {
  it("loses the ordered-list marker along with the list", () => {
    expect(inline("1. foo").trim()).toBe("foo");
  });

  it("loses the bullet marker along with the list", () => {
    expect(inline("- foo").trim()).toBe("foo");
  });

  it("loses an image entirely, alt text included", () => {
    const html = inline("![a diagram](/x.png) explains it");

    expect(html).not.toContain("<img");
    expect(html).not.toContain("a diagram");
    expect(html.trim()).toBe("explains it");
  });

  it("loses a task-list checkbox but keeps the item text", () => {
    const html = inline("- [ ] ship it");

    expect(html).not.toContain("<input");
    expect(html).toContain("ship it");
  });
});
