import { afterEach, describe, expect, it } from "vitest";
import { Octokit } from "@octokit/rest";
import { timeboxedFetch } from "./timeboxed-fetch";
import { translateOctokitError, GitHubTimeoutError } from "./errors";

const URL_UNDER_TEST = "https://api.github.com/repos/o/r/pulls/1";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(impl: typeof fetch): void {
  globalThis.fetch = impl;
}

function hangs(): typeof fetch {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
}

function slowBody(chunkDelayMs: number): typeof fetch {
  return async (_input, init) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            if (init?.signal?.aborted) {
              controller.error(init.signal.reason);
              return;
            }
            controller.enqueue(new TextEncoder().encode('{"ok":true}'));
            controller.close();
          }, chunkDelayMs);
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
}

describe("timeboxedFetch before the headers arrive", () => {
  it("gives up at the budget", async () => {
    stubFetch(hangs());

    await expect(timeboxedFetch(20)(URL_UNDER_TEST)).rejects.toSatisfy(
      (e) => e instanceof DOMException && e.name === "TimeoutError"
    );
  });

  it("rethrows the caller's abort instead of its own timeout", async () => {
    const user = new AbortController();
    stubFetch(hangs());

    const pending = timeboxedFetch(5_000)(URL_UNDER_TEST, {
      signal: user.signal,
    });
    user.abort();

    await expect(pending).rejects.toSatisfy(
      (e) => e instanceof DOMException && e.name === "AbortError"
    );
  });
});

describe("timeboxedFetch once the headers arrive", () => {
  it("releases the timer, so a body slower than the budget still reads", async () => {
    stubFetch(slowBody(60));

    const response = await timeboxedFetch(20)(URL_UNDER_TEST);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("still lets the caller's abort reach a body in flight", async () => {
    const user = new AbortController();
    stubFetch(slowBody(60));

    const response = await timeboxedFetch(5_000)(URL_UNDER_TEST, {
      signal: user.signal,
    });
    user.abort();

    await expect(response.text()).rejects.toSatisfy(
      (e) => e instanceof DOMException && e.name === "AbortError"
    );
  });
});

describe("a timed-out GitHub call end to end", () => {
  it("reaches the caller as GitHubTimeoutError, not as a retryable 500", async () => {
    stubFetch(hangs());
    const client = new Octokit({
      auth: "x",
      request: { fetch: timeboxedFetch(20) },
    });

    try {
      await client.rest.pulls.get({ owner: "o", repo: "r", pull_number: 1 });
      expect.unreachable();
    } catch (err) {
      expect(() => translateOctokitError(err, "PR o/r#1")).toThrow(
        GitHubTimeoutError
      );
    }
  });

  it("does not reach the caller as a misread body error", async () => {
    stubFetch(slowBody(60));
    const client = new Octokit({
      auth: "x",
      request: { fetch: timeboxedFetch(20) },
    });

    const { data } = await client.rest.pulls.get({
      owner: "o",
      repo: "r",
      pull_number: 1,
    });

    expect(data).toEqual({ ok: true });
  });
});
