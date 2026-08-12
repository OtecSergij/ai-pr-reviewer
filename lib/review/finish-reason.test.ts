import { describe, it, expect } from "vitest";
import type { FinishReason } from "ai";
import { nextFinishReason } from "./finish-reason";
import type { ReviewChunk } from "./stream";

const meta: ReviewChunk = {
  type: "data-meta",
  transient: true,
  data: {
    owner: "octocat",
    repo: "hello-world",
    prNumber: 1,
    title: "Add a greeting",
    headSha: "0123456789abcdef0123456789abcdef01234567",
    isPrivate: false,
    model: "openai/gpt-oss-120b",
  },
};

const failover: ReviewChunk = {
  type: "data-failover",
  transient: true,
  data: { from: "groq", to: "cerebras", reason: "output-truncated" },
};

const finish = (finishReason: FinishReason): ReviewChunk => ({
  type: "finish",
  finishReason,
});

const usage: ReviewChunk = {
  type: "data-usage",
  transient: true,
  data: { tokens: 128 },
};

function replay(chunks: ReviewChunk[]): FinishReason | null {
  return chunks.reduce<FinishReason | null>(
    (current, chunk) => nextFinishReason(current, chunk),
    null
  );
}

describe("nextFinishReason", () => {
  it("lets a candidate that finishes cleanly overwrite an earlier cut-short one", () => {
    expect(
      replay([meta, finish("length"), failover, meta, finish("stop")])
    ).toBe("stop");
  });

  it("keeps the cut-short reason when no candidate follows", () => {
    expect(replay([meta, finish("length")])).toBe("length");
  });

  it("keeps the cut-short reason across chunks that carry no verdict", () => {
    expect(replay([meta, finish("length"), usage, failover])).toBe("length");
  });

  it("clears the previous verdict when the next candidate announces itself", () => {
    expect(replay([meta, finish("stop"), meta])).toBeNull();
  });
});
