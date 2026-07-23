import { describe, it, expect } from "vitest";
import { parsePRUrl, InvalidPRUrl } from "./parse-url";

describe("parsePRUrl", () => {
  it("parses a canonical PR URL", () => {
    expect(parsePRUrl("https://github.com/vercel/next.js/pull/123")).toEqual({
      owner: "vercel",
      repo: "next.js",
      prNumber: 123,
    });
  });

  it("accepts tab suffixes after the number", () => {
    for (const tab of ["files", "commits", "checks"]) {
      expect(
        parsePRUrl(`https://github.com/vercel/next.js/pull/123/${tab}`),
      ).toEqual({ owner: "vercel", repo: "next.js", prNumber: 123 });
    }
  });

  it("accepts the www. host", () => {
    expect(parsePRUrl("https://www.github.com/a/b/pull/7")).toEqual({
      owner: "a",
      repo: "b",
      prNumber: 7,
    });
  });

  it("ignores trailing slash, query and fragment", () => {
    expect(parsePRUrl("https://github.com/a/b/pull/9/")).toEqual({
      owner: "a",
      repo: "b",
      prNumber: 9,
    });
    expect(parsePRUrl("https://github.com/a/b/pull/9?diff=split")).toEqual({
      owner: "a",
      repo: "b",
      prNumber: 9,
    });
    expect(parsePRUrl("https://github.com/a/b/pull/9#discussion")).toEqual({
      owner: "a",
      repo: "b",
      prNumber: 9,
    });
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parsePRUrl("  https://github.com/a/b/pull/1  ")).toEqual({
      owner: "a",
      repo: "b",
      prNumber: 1,
    });
  });

  it("parses a multi-digit PR number exactly", () => {
    expect(parsePRUrl("https://github.com/a/b/pull/1000").prNumber).toBe(1000);
  });

  it("rejects a PR number beyond safe-integer precision", () => {
    expect(() =>
      parsePRUrl("https://github.com/a/b/pull/99999999999999999999"),
    ).toThrow(InvalidPRUrl);
  });

  it("rejects a string that is not a URL", () => {
    expect(() => parsePRUrl("not a url")).toThrow(InvalidPRUrl);
  });

  it("rejects a foreign host", () => {
    expect(() => parsePRUrl("https://gitlab.com/a/b/pull/1")).toThrow(
      InvalidPRUrl,
    );
  });

  it("rejects a path that is not /pull/", () => {
    expect(() => parsePRUrl("https://github.com/a/b/tree/1")).toThrow(
      InvalidPRUrl,
    );
    expect(() => parsePRUrl("https://github.com/a/b")).toThrow(InvalidPRUrl);
  });

  it("rejects a URL whose empty segments collapse the path shape", () => {
    for (const url of [
      "https://github.com//b/pull/1",
      "https://github.com/a//pull/1",
    ]) {
      try {
        parsePRUrl(url);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidPRUrl);
        expect((err as InvalidPRUrl).reason).toContain("expected path");
      }
    }
  });

  it("rejects non-decimal PR numbers", () => {
    for (const n of ["0x10", "1e2", "+5", "123.0", "abc"]) {
      expect(() => parsePRUrl(`https://github.com/a/b/pull/${n}`)).toThrow(
        InvalidPRUrl,
      );
    }
  });

  it("rejects zero and negative PR numbers", () => {
    expect(() => parsePRUrl("https://github.com/a/b/pull/0")).toThrow(
      InvalidPRUrl,
    );
    expect(() => parsePRUrl("https://github.com/a/b/pull/-5")).toThrow(
      InvalidPRUrl,
    );
  });

  it("exposes the reason and input on the thrown error", () => {
    try {
      parsePRUrl("https://gitlab.com/a/b/pull/1");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPRUrl);
      const e = err as InvalidPRUrl;
      expect(e.code).toBe("INVALID_PR_URL");
      expect(e.input).toBe("https://gitlab.com/a/b/pull/1");
      expect(e.reason).toContain("github.com");
    }
  });
});
