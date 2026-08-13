import "server-only";
import { asSchema, type FlexibleSchema, type ModelMessage } from "ai";
import { SYSTEM } from "@/lib/review/system-prompt";

const CHARS_PER_TOKEN = 3.5;
const BUDGET_HEADROOM = 0.8;

export type BudgetTool = { description?: string; inputSchema: unknown };

const overheadByToolSet = new WeakMap<Record<string, BudgetTool>, number>();

function overheadChars(tools: Record<string, BudgetTool>): number {
  const memoized = overheadByToolSet.get(tools);
  if (memoized !== undefined) return memoized;

  const schemas = JSON.stringify(
    Object.entries(tools).map(([name, tool]) => ({
      name,
      description: tool.description,
      parameters: asSchema(tool.inputSchema as FlexibleSchema<unknown>)
        .jsonSchema,
    })),
  );

  const chars = SYSTEM.length + schemas.length;
  overheadByToolSet.set(tools, chars);
  return chars;
}

export function estimateInputTokens(
  messages: ModelMessage[],
  tools: Record<string, BudgetTool>,
  maxOutputTokens?: number,
): number {
  const chars = JSON.stringify(messages).length + overheadChars(tools);
  return Math.ceil(chars / CHARS_PER_TOKEN) + (maxOutputTokens ?? 0);
}

export function budgetCeiling(tpmBudget: number): number {
  return Math.floor(tpmBudget * BUDGET_HEADROOM);
}
