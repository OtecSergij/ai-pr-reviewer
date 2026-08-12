import type {
  streamText,
  ToolCallOptions,
  ToolExecuteFunction,
} from "ai";
import { env } from "@/lib/env";

import { REVIEW_TOOL_NAMES } from "@/lib/review/tools/tool-names";
import type { ReviewToolName } from "@/lib/review/tools/tool-names";
import { modelIssueSchema } from "@/lib/review/model-issue.schema";
import type { ReviewChunk } from "@/lib/review/stream";
import { errorToMessage } from "@/lib/review/errors";
import {
  injectedStartError,
  injectedStreamError,
  streamErrorStopIndex,
} from "@/lib/review/mock/injected-error";
import {
  createMockIdScope,
  isIssueStep,
  selectScenario,
} from "@/lib/review/mock/scenario";
import type {
  MockIdScope,
  MockScenario,
  MockTextBlock,
  MockToolStep,
} from "@/lib/review/mock/scenario";
import { createToolStepResult } from "@/lib/review/mock/step-result";
import { logger } from "@/lib/log";

const TEXT_DELTA_PAUSE_MS = 150;
const EVENT_PAUSE_MS = 250;
const TOOL_PAUSE_MS = 500;
const FIRST_TOOL_STEP = 0;

type StreamTextOptions = Parameters<typeof streamText>[0];

export const streamTextMock = ((options: StreamTextOptions) => ({
  toUIMessageStream: () => mockUIStream(options),
})) as unknown as typeof streamText;

async function* mockUIStream(
  options: StreamTextOptions
): AsyncGenerator<ReviewChunk> {
  try {
    for await (const chunk of reviewScenario(options)) {
      yield chunk;
    }
  } catch (e) {
    options.onError?.({ error: e });
    yield { type: "error", errorText: errorToMessage(e) };
  }
}

async function* reviewScenario(
  options: StreamTextOptions
): AsyncGenerator<ReviewChunk> {
  const signal = options.abortSignal;
  const scopeId = createMockIdScope();

  const injected = injectedStartError();
  if (injected) throw injected;

  if (env.MOCK_ERROR === "tool-outcomes") {
    if (env.MOCK_SCENARIO) {
      logger.warn(
        { mockError: env.MOCK_ERROR, mockScenario: env.MOCK_SCENARIO },
        "MOCK_SCENARIO ignored: MOCK_ERROR=tool-outcomes streams its own fixture"
      );
    }
    yield* toolOutcomesDemo(options, scopeId);
    return;
  }

  const scenario = selectScenario(env.MOCK_SCENARIO);
  assertScenarioIssues(scenario);

  const stopIndex = streamErrorStopIndex(scenario.steps, options.messages);
  let toolStepNumber = 0;

  yield { type: "start" };

  for (const [index, step] of scenario.steps.entries()) {
    switch (step.kind) {
      case "text":
        yield* textBlock(scopedBlock(step, scopeId), signal);
        break;
      case "reasoning":
        yield* reasoningBlock(scopedBlock(step, scopeId), signal);
        break;
      case "interleaved-text":
        yield* interleavedTextBlocks(
          scopedBlock(step.first, scopeId),
          scopedBlock(step.second, scopeId),
          signal
        );
        break;
      case "tool":
        yield* toolStep(options, step, toolStepNumber, scopeId, signal);
        toolStepNumber++;
        break;
    }

    if (signal?.aborted) return;

    if (index === stopIndex) throw injectedStreamError();
  }

  yield { type: "finish", finishReason: scenario.finishReason };
}

function scopedBlock(block: MockTextBlock, scopeId: MockIdScope): MockTextBlock {
  return { id: scopeId(block.id), deltas: block.deltas };
}

function assertScenarioIssues(scenario: MockScenario): void {
  for (const step of scenario.steps) {
    if (!isIssueStep(step)) continue;

    const parsed = modelIssueSchema.safeParse(step.input);
    if (parsed.success) continue;

    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(
      `streamTextMock: fixture issue "${step.toolCallId}" no longer satisfies modelIssueSchema — ${problems}`
    );
  }
}

async function* toolOutcomesDemo(
  options: StreamTextOptions,
  scopeId: MockIdScope
): AsyncGenerator<ReviewChunk> {
  const signal = options.abortSignal;
  const failedCallId = scopeId("demo-fail");

  yield { type: "start" };

  yield* textBlock(
    scopedBlock(
      {
        id: "demo-text",
        deltas: ["Demonstrating tool outcomes: ", "one skipped, one failed."],
      },
      scopeId
    ),
    signal
  );
  if (signal?.aborted) return;

  yield* toolStep(
    options,
    {
      kind: "tool",
      toolCallId: "demo-skip",
      toolName: REVIEW_TOOL_NAMES.getFileContents,
      input: { path: "does/not/exist.ts" },
    },
    FIRST_TOOL_STEP,
    scopeId,
    signal
  );
  if (signal?.aborted) return;

  yield {
    type: "tool-input-available",
    toolCallId: failedCallId,
    toolName: REVIEW_TOOL_NAMES.getDiff,
    input: { filename: "index.js" },
  };
  await sleep(TOOL_PAUSE_MS, signal);
  if (signal?.aborted) return;
  yield {
    type: "tool-output-error",
    toolCallId: failedCallId,
    errorText: "Simulated tool failure",
  };

  yield { type: "finish", finishReason: "stop" };
}

async function* textBlock(
  block: MockTextBlock,
  signal?: AbortSignal
): AsyncGenerator<ReviewChunk> {
  if (signal?.aborted) return;
  await sleep(EVENT_PAUSE_MS, signal);
  if (signal?.aborted) return;

  yield { type: "text-start", id: block.id };

  for (const delta of block.deltas) {
    await sleep(TEXT_DELTA_PAUSE_MS, signal);
    if (signal?.aborted) return;
    yield { type: "text-delta", id: block.id, delta };
  }

  yield { type: "text-end", id: block.id };
}

async function* reasoningBlock(
  block: MockTextBlock,
  signal?: AbortSignal
): AsyncGenerator<ReviewChunk> {
  if (signal?.aborted) return;
  await sleep(EVENT_PAUSE_MS, signal);
  if (signal?.aborted) return;

  yield { type: "reasoning-start", id: block.id };

  for (const delta of block.deltas) {
    await sleep(TEXT_DELTA_PAUSE_MS, signal);
    if (signal?.aborted) return;
    yield { type: "reasoning-delta", id: block.id, delta };
  }

  yield { type: "reasoning-end", id: block.id };
}

async function* interleavedTextBlocks(
  first: MockTextBlock,
  second: MockTextBlock,
  signal?: AbortSignal
): AsyncGenerator<ReviewChunk> {
  if (signal?.aborted) return;
  await sleep(EVENT_PAUSE_MS, signal);
  if (signal?.aborted) return;

  yield { type: "text-start", id: first.id };
  yield { type: "text-start", id: second.id };

  const rounds = Math.max(first.deltas.length, second.deltas.length);

  for (let round = 0; round < rounds; round++) {
    for (const block of [first, second]) {
      const delta = block.deltas[round];
      if (delta === undefined) continue;

      await sleep(TEXT_DELTA_PAUSE_MS, signal);
      if (signal?.aborted) return;
      yield { type: "text-delta", id: block.id, delta };
    }
  }

  yield { type: "text-end", id: first.id };
  yield { type: "text-end", id: second.id };
}

async function* toolStep(
  options: StreamTextOptions,
  step: MockToolStep,
  stepNumber: number,
  scopeId: MockIdScope,
  signal?: AbortSignal
): AsyncGenerator<ReviewChunk> {
  const { toolName, input } = step;
  const toolCallId = scopeId(step.toolCallId);

  if (signal?.aborted) return;
  await sleep(TOOL_PAUSE_MS, signal);
  if (signal?.aborted) return;

  yield { type: "tool-input-available", toolCallId, toolName, input };

  const output = await callTool(
    options.tools,
    toolName,
    input,
    toolCallId,
    signal
  );
  if (signal?.aborted) return;

  yield { type: "tool-output-available", toolCallId, output };

  await options.onStepFinish?.(
    createToolStepResult({
      model: options.model,
      stepNumber,
      toolName,
      toolCallId,
      input,
      output,
      scopeId,
    })
  );
}

async function callTool(
  tools: StreamTextOptions["tools"],
  toolName: ReviewToolName,
  input: unknown,
  toolCallId: string,
  signal?: AbortSignal
): Promise<unknown> {
  const execute = tools?.[toolName]?.execute as
    | ToolExecuteFunction<unknown, unknown>
    | undefined;

  if (!execute) {
    throw new Error(
      `streamTextMock: tool "${toolName}" has no execute — the mock can only call the real route tools`
    );
  }

  const callOptions: ToolCallOptions = {
    toolCallId,
    messages: [],
    abortSignal: signal,
  };

  return await execute(input, callOptions);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(finish, ms);

    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }

    signal?.addEventListener("abort", finish, { once: true });
  });
}
