import type {
  JSONValue,
  LanguageModel,
  LanguageModelUsage,
  StepResult,
  ToolSet,
} from "ai";

import { REVIEW_TOOL_NAMES } from "@/lib/review/tools/tool-names";
import type { ReviewToolName } from "@/lib/review/tools/tool-names";
import type { MockIdScope } from "@/lib/review/mock/scenario";

type MockStepResult = StepResult<ToolSet>;

type ResponseMessage = MockStepResult["response"]["messages"][number];

const FIRST_STEP_NUMBER = 0;
const BASE_INPUT_TOKENS = 4_200;
const INPUT_TOKENS_PER_STEP = 380;
const OUTPUT_TOKENS_PER_STEP = 145;
const ORPHANED_TOOL_CALL_ID = "mock-orphaned-call";

function messagesDroppedByHandoff(scopeId: MockIdScope): ResponseMessage[] {
  return [
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "The diff alone may not be enough here." },
        { type: "text", text: "" },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: scopeId(ORPHANED_TOOL_CALL_ID),
          toolName: REVIEW_TOOL_NAMES.getDiff,
          output: { type: "json", value: { patch: null } },
        },
      ],
    },
  ];
}

function modelIdentity(model: LanguageModel): {
  provider: string;
  modelId: string;
} {
  return typeof model === "string"
    ? { provider: "mock", modelId: model }
    : { provider: model.provider, modelId: model.modelId };
}

function toJsonValue(output: unknown): JSONValue {
  return JSON.parse(JSON.stringify(output ?? null)) as JSONValue;
}

function stepUsage(stepNumber: number): LanguageModelUsage {
  const inputTokens = BASE_INPUT_TOKENS + stepNumber * INPUT_TOKENS_PER_STEP;

  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: OUTPUT_TOKENS_PER_STEP,
    outputTokenDetails: {
      textTokens: OUTPUT_TOKENS_PER_STEP,
      reasoningTokens: 0,
    },
    totalTokens: inputTokens + OUTPUT_TOKENS_PER_STEP,
  };
}

export function createToolStepResult({
  model,
  stepNumber,
  toolName,
  toolCallId,
  input,
  output,
  scopeId,
}: {
  model: LanguageModel;
  stepNumber: number;
  toolName: ReviewToolName;
  toolCallId: string;
  input: unknown;
  output: unknown;
  scopeId: MockIdScope;
}): MockStepResult {
  const { provider, modelId } = modelIdentity(model);
  const toolCall = {
    type: "tool-call" as const,
    toolCallId,
    toolName,
    input,
  };
  const toolResult = {
    type: "tool-result" as const,
    toolCallId,
    toolName,
    input,
    output,
  };

  return {
    stepNumber,
    model: { provider, modelId },
    functionId: undefined,
    metadata: undefined,
    experimental_context: undefined,
    content: [toolCall, toolResult],
    text: "",
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    toolCalls: [toolCall],
    staticToolCalls: [toolCall],
    dynamicToolCalls: [],
    toolResults: [toolResult],
    staticToolResults: [toolResult],
    dynamicToolResults: [],
    finishReason: "tool-calls",
    rawFinishReason: "tool_calls",
    usage: stepUsage(stepNumber),
    warnings: [],
    request: {},
    response: {
      id: scopeId(`mock-response-${stepNumber}`),
      timestamp: new Date(),
      modelId,
      messages: [
        ...(stepNumber === FIRST_STEP_NUMBER
          ? messagesDroppedByHandoff(scopeId)
          : []),
        { role: "assistant", content: [toolCall] },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId,
              toolName,
              output: { type: "json", value: toJsonValue(output) },
            },
          ],
        },
      ],
    },
    providerMetadata: undefined,
  };
}
