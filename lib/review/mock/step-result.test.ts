import { describe, expect, it } from "vitest";

import { REVIEW_TOOL_NAMES } from "@/lib/review/tools/tool-names";
import { createToolStepRecorder } from "./step-result";

const identityScope = (id: string) => id;

function recordTwoSteps() {
  const record = createToolStepRecorder("mock-model", identityScope);

  const first = record({
    stepNumber: 0,
    toolName: REVIEW_TOOL_NAMES.getPrMetadata,
    toolCallId: "call-first",
    input: {},
    output: { title: "add weeks" },
  });

  const second = record({
    stepNumber: 1,
    toolName: REVIEW_TOOL_NAMES.getDiff,
    toolCallId: "call-second",
    input: { filename: "index.js" },
    output: { patch: "@@" },
  });

  return { first, second };
}

const toolCallIdsOf = (messages: { role: string; content: unknown }[]) =>
  messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      Array.isArray(message.content)
        ? (message.content as { type: string; toolCallId?: string }[])
        : [],
    )
    .flatMap((part) =>
      part.type === "tool-call" && part.toolCallId ? [part.toolCallId] : [],
    );

describe("createToolStepRecorder", () => {
  it("reports the whole transcript so far, the way streamText does", () => {
    const { first, second } = recordTwoSteps();

    expect(second.response.messages.length).toBeGreaterThan(
      first.response.messages.length,
    );
    expect(
      second.response.messages.slice(0, first.response.messages.length),
    ).toEqual(first.response.messages);
  });

  it("names every tool call once, so a consumer cannot double-count them", () => {
    const { second } = recordTwoSteps();

    const ids = toolCallIdsOf(second.response.messages);

    expect(ids).toEqual(["call-first", "call-second"]);
  });

  it("keeps each step's own content to that step", () => {
    const { first, second } = recordTwoSteps();

    expect(first.content).toHaveLength(2);
    expect(second.content).toHaveLength(2);
  });
});
