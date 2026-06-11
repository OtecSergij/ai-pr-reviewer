import { ISSUE_DATA_KEY, type ModelIssue } from "@/lib/ai/schema/modelIssue";

export type IssuePayload = ModelIssue;

export type ReviewStatus = "idle" | "running" | "done" | "error" | "aborted";

/**
 * Текущая активность агента — сырые данные тула из чанка.
 * В человекочитаемую строку («Читаю diff: …») превращает презентация (панель),
 * хук формат не знает.
 */
export type ToolActivity = { toolName: string; input: unknown };

export enum ReviewChunkType {
  TEXT_START = "text-start",
  TEXT_DELTA = "text-delta",
  TEXT_END = "text-end",
  TOOL_INPUT_START = "tool-input-start",
  TOOL_INPUT_DELTA = "tool-input-delta",
  TOOL_INPUT_AVAILABLE = "tool-input-available",
  TOOL_OUTPUT_AVAILABLE = "tool-output-available",
  TOOL_OUTPUT_ERROR = "tool-output-error",
  DATA_ISSUE = "data-issue",
  START = "start",
  FINISH = "finish",
  START_STEP = "start-step",
  FINISH_STEP = "finish-step",
  ERROR = "error",
}

/**
 * Компайл-скрепка клиент↔сервер для data-канала issue: значение enum обязано
 * совпасть с `data-${ISSUE_DATA_KEY}` из серверной схемы. Переименуют канал на
 * сервере — этот тип станет never, и ветка DATA_ISSUE в хуке перестанет
 * компилироваться (обнови литерал в enum). Сослаться константой прямо в enum
 * нельзя: члены строкового enum — только литералы (TS18033).
 */
type IssueChunkType =
  `${ReviewChunkType.DATA_ISSUE}` extends `data-${typeof ISSUE_DATA_KEY}`
    ? ReviewChunkType.DATA_ISSUE
    : never;

export type ReviewChunk =
  | { type: ReviewChunkType.TEXT_START; id: string }
  | { type: ReviewChunkType.TEXT_DELTA; id: string; delta: string }
  | { type: ReviewChunkType.TEXT_END; id: string }
  | {
      type: ReviewChunkType.TOOL_INPUT_START;
      toolCallId: string;
      toolName: string;
    }
  | {
      type: ReviewChunkType.TOOL_INPUT_DELTA;
      toolCallId: string;
      inputTextDelta: string;
    }
  | {
      type: ReviewChunkType.TOOL_INPUT_AVAILABLE;
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: ReviewChunkType.TOOL_OUTPUT_AVAILABLE;
      toolCallId: string;
      output: unknown;
    }
  | {
      type: ReviewChunkType.TOOL_OUTPUT_ERROR;
      toolCallId: string;
      errorText: string;
    }
  | {
      type: IssueChunkType;
      data: IssuePayload;
      id?: string;
      transient?: boolean;
    }
  | { type: ReviewChunkType.START; messageId?: string }
  | { type: ReviewChunkType.FINISH; finishReason?: string }
  | { type: ReviewChunkType.START_STEP }
  | { type: ReviewChunkType.FINISH_STEP }
  | { type: ReviewChunkType.ERROR; errorText: string };
