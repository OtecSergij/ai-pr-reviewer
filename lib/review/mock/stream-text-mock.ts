import type {
  InferUIMessageChunk,
  streamText,
  ToolCallOptions,
  ToolExecuteFunction,
} from "ai";
import { APICallError, RetryError, LoadAPIKeyError } from "ai";
import { env } from "@/lib/env";

import { REVIEW_TOOL_NAMES } from "@/lib/review/tools/tool-names";
import type { ReviewToolName } from "@/lib/review/tools/tool-names";
import { modelIssueSchema } from "@/lib/review/model-issue.schema";
import type { ModelIssue } from "@/lib/review/model-issue.schema";
import type { ReviewUIMessage } from "@/lib/review/stream";
import { errorToMessage } from "@/lib/review/errors";

// Вставлять этот URL в форму при MOCK_REVIEW=1.
// vercel/ms#35 — merged в 2014-м, 3 файла (index.js, test/test.js, README.md),
// у всех непустой patch; PR старый и закрытый, координаты фикстур ниже вечные.
export const MOCK_PR_URL = "https://github.com/vercel/ms/pull/35";

// Паузы между событиями стрима — имитируют темп реального LLM.
const TEXT_DELTA_PAUSE_MS = 150; // между text-delta внутри блока
const EVENT_PAUSE_MS = 250; // перед началом текстового блока
const TOOL_PAUSE_MS = 500; // «модель решает дёрнуть тул»

// Фикстурные issue указывают на реальные added-строки PR vercel/ms#35.
export const mockModelIssues: ModelIssue[] = [
  // index.js, hunk @@ -53,16 +55,26 @@: строки 74–77 новой версии — это
  // added-блок `case 'milliseconds':` … `case 'msec':`.
  {
    file: "index.js",
    line_start: 74,
    line_end: 77,
    severity: "warning",
    title: "Unit aliases are duplicated between the regex and the switch",
    body: "Every alias now has to be listed twice: once in the `parse` regex and once in this `switch`. Nothing checks that the two lists stay in sync, so they will drift:\n\n- an alias matched by the regex but missing here makes `parse` return `undefined` silently;\n- a `case` without a regex counterpart is dead code.\n\nA single lookup table would keep one source of truth.",
    suggestion:
      "```js\nvar factors = {\n  ms: 1, msec: 1, msecs: 1, millisecond: 1, milliseconds: 1,\n  s: s, sec: s, secs: s, second: s, seconds: s,\n  // … same for the other units\n};\nreturn n * factors[type];\n```",
  },
  // test/test.js, hunk @@ -52,6 +56,38 @@: строка 61 новой версии — added-строка
  // `describe('ms(long string)', function(){`.
  {
    file: "test/test.js",
    line_start: 61,
    line_end: 61,
    severity: "nit",
    title: 'describe label says "long string" but the block mostly tests abbreviations',
    body: "`'17 msecs'`, `'1 sec'`, `'1 min'`, `'1 hr'` are abbreviations, not long units. A failing test in this block would point at the wrong place — consider renaming or splitting it.",
  },
];

// Тот же тип options, что у настоящего streamText, — вызов в route
// компилируется без изменений при подмене реализации.
type StreamTextOptions = Parameters<typeof streamText>[0];

// Ровно тот тип чанков, который цикл ревью пишет в writer.
type MockChunk = InferUIMessageChunk<ReviewUIMessage>;

// Мок структурно реализует лишь то, что дёргает цикл ревью
// (toUIMessageStream + колбэки из options), поэтому приводим его к полному типу
// streamText через unknown — иначе union `mock | real` в run-review не сойдётся.
export const streamTextMock = ((options: StreamTextOptions) => ({
  toUIMessageStream: () => mockUIStream(options),
})) as unknown as typeof streamText;

// Async-генератор, а не ReadableStream: цикл ревью потребляет результат через
// `for await`, а web-ReadableStream в TS-типах не async-iterable.
async function* mockUIStream(
  options: StreamTextOptions
): AsyncGenerator<MockChunk> {
  try {
    for await (const chunk of reviewScenario(options)) {
      yield chunk;
    }
  } catch (e) {
    // Настоящий streamText на сбое и дёргает options.onError, и кладёт error-чанк
    // в стрим. Мок делает то же: onError выставляет флаг детекта в цикле, а
    // сам error-чанк цикл отфильтрует.
    options.onError?.({ error: e });
    yield { type: "error", errorText: errorToMessage(e) };
  }
}

// Dev-only фабрика инъектируемых ошибок (MOCK_ERROR) для проверки пути 2.
// Классы настоящие — иначе .isInstance в errorToMessage вернёт false и
// классификация не сработает.
function injectedError(): unknown {
  const apiUrl = "https://mock.provider/v1/messages";

  switch (env.MOCK_ERROR) {
    case "api-retryable":
      return new APICallError({
        message: "Service Unavailable",
        url: apiUrl,
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      });
    case "retry-exhausted":
      return new RetryError({
        message: "Failed after maximum retries",
        reason: "maxRetriesExceeded",
        errors: [
          new APICallError({
            message: "Service Unavailable",
            url: apiUrl,
            requestBodyValues: {},
            statusCode: 503,
            isRetryable: true,
          }),
        ],
      });
    case "api-400":
      return new APICallError({
        message: "Bad Request",
        url: apiUrl,
        requestBodyValues: {},
        statusCode: 400,
        isRetryable: false,
      });
    case "load-key":
      return new LoadAPIKeyError({ message: "API key is missing" });
    case "unknown":
      return new Error("Something unexpected blew up");
    default:
      return undefined;
  }
}

// Сценарий ревью: те же типы чанков и в том же порядке, что у настоящего
// streamText + клиентского switch в use-review.ts (text-start даёт разрыв
// абзаца, tool-input-available — строку активности, data-issue придёт
// из настоящего emit_issue.execute).
async function* reviewScenario(
  options: StreamTextOptions
): AsyncGenerator<MockChunk> {
  const { tools, abortSignal: signal } = options;

  // Dev-инъекция ошибки (MOCK_ERROR): бросаем типизированную ошибку, чтобы
  // прогнать её через реальный onError → errorToMessage пути 2.
  const injected = injectedError();
  if (injected) throw injected;

  if (env.MOCK_ERROR === "tool-outcomes") {
    yield* toolOutcomesDemo(tools, signal);
    return;
  }

  // Настоящий streamText гоняет input через zod до execute, мок зовёт execute
  // напрямую — поэтому фикстуры проверяем сами: правка координат/полей упадёт
  // громко (error-чанком), а не нарисует мусор в карточках.
  for (const issue of mockModelIssues) modelIssueSchema.parse(issue);

  yield { type: "start" };

  yield* textBlock(
    "mock-text-1",
    [
      "Taking a look at this PR. ",
      "First the metadata — ",
      "title, description, scope — ",
      "then the changed files.",
    ],
    signal
  );
  if (signal?.aborted) return;

  yield* toolStep(tools, REVIEW_TOOL_NAMES.getPrMetadata, {}, "mock-call-1", signal);
  if (signal?.aborted) return;

  yield* toolStep(tools, REVIEW_TOOL_NAMES.getPrFilesSummary, {}, "mock-call-2", signal);
  if (signal?.aborted) return;

  yield* textBlock(
    "mock-text-2",
    [
      "Three files changed: ",
      "`index.js`, `test/test.js` and `README.md`. ",
      "The parser change in `index.js` is the core of the PR — ",
      "reading its diff first.",
    ],
    signal
  );
  if (signal?.aborted) return;

  yield* toolStep(
    tools,
    REVIEW_TOOL_NAMES.getDiff,
    { filename: "index.js" },
    "mock-call-3",
    signal
  );
  if (signal?.aborted) return;

  yield* toolStep(
    tools,
    REVIEW_TOOL_NAMES.emitIssue,
    mockModelIssues[0],
    "mock-call-4",
    signal
  );
  if (signal?.aborted) return;

  yield* textBlock(
    "mock-text-3",
    [
      "The unit table in `parse` is worth flagging. ",
      "Now checking the new tests ",
      "in `test/test.js`.",
    ],
    signal
  );
  if (signal?.aborted) return;

  yield* toolStep(
    tools,
    REVIEW_TOOL_NAMES.getDiff,
    { filename: "test/test.js" },
    "mock-call-5",
    signal
  );
  if (signal?.aborted) return;

  yield* toolStep(
    tools,
    REVIEW_TOOL_NAMES.emitIssue,
    mockModelIssues[1],
    "mock-call-6",
    signal
  );
  if (signal?.aborted) return;

  yield* textBlock(
    "mock-text-4",
    [
      "**Review finished.** ",
      "I reported 2 issues: a `warning` about the duplicated unit list in `index.js` ",
      "and a `nit` about a misleading test label. ",
      "Overall the change looks solid — every new alias is covered by tests.",
    ],
    signal
  );
  if (signal?.aborted) return;

  yield { type: "finish", finishReason: "stop" };
}

// Dev-демо (MOCK_ERROR=tool-outcomes): показать исходы тулзов в консоли —
// реальный {status} (skipped) и синтетический tool-output-error (failed).
async function* toolOutcomesDemo(
  tools: StreamTextOptions["tools"],
  signal?: AbortSignal
): AsyncGenerator<MockChunk> {
  yield { type: "start" };

  yield* textBlock(
    "demo-text",
    ["Demonstrating tool outcomes: ", "one skipped, one failed."],
    signal
  );
  if (signal?.aborted) return;

  yield* toolStep(
    tools,
    REVIEW_TOOL_NAMES.getFileContents,
    { path: "does/not/exist.ts" },
    "demo-skip",
    signal
  );
  if (signal?.aborted) return;

  yield {
    type: "tool-input-available",
    toolCallId: "demo-fail",
    toolName: REVIEW_TOOL_NAMES.getDiff,
    input: { filename: "index.js" },
  };
  await sleep(TOOL_PAUSE_MS, signal);
  if (signal?.aborted) return;
  yield {
    type: "tool-output-error",
    toolCallId: "demo-fail",
    errorText: "Simulated tool failure",
  };

  yield { type: "finish", finishReason: "stop" };
}

async function* textBlock(
  id: string,
  deltas: string[],
  signal?: AbortSignal
): AsyncGenerator<MockChunk> {
  if (signal?.aborted) return;
  await sleep(EVENT_PAUSE_MS, signal);
  if (signal?.aborted) return;

  yield { type: "text-start", id };

  for (const delta of deltas) {
    await sleep(TEXT_DELTA_PAUSE_MS, signal);
    if (signal?.aborted) return;
    yield { type: "text-delta", id, delta };
  }

  yield { type: "text-end", id };
}

async function* toolStep(
  tools: StreamTextOptions["tools"],
  toolName: ReviewToolName,
  input: unknown,
  toolCallId: string,
  signal?: AbortSignal
): AsyncGenerator<MockChunk> {
  if (signal?.aborted) return;
  await sleep(TOOL_PAUSE_MS, signal);
  if (signal?.aborted) return;

  yield { type: "tool-input-available", toolCallId, toolName, input };

  const output = await callTool(tools, toolName, input, toolCallId, signal);
  if (signal?.aborted) return;

  yield { type: "tool-output-available", toolCallId, output };
}

async function callTool(
  tools: StreamTextOptions["tools"],
  toolName: ReviewToolName,
  input: unknown,
  toolCallId: string,
  signal?: AbortSignal
): Promise<unknown> {
  // В ToolSet execute опционален и типизирован в том числе под never-инпуты,
  // поэтому сужаем до общей формы сами (без `!`): мок передаёт корректные
  // инпуты по построению, важен рантайм-вызов.
  const execute = tools?.[toolName]?.execute as
    | ToolExecuteFunction<unknown, unknown>
    | undefined;

  if (!execute) {
    throw new Error(
      `streamTextMock: tool "${toolName}" has no execute — мок умеет звать только реальные тулзы route`
    );
  }

  const callOptions: ToolCallOptions = {
    toolCallId,
    messages: [],
    abortSignal: signal,
  };

  return await execute(input, callOptions);
}

// Пауза, не переживающая abort: по сигналу резолвится сразу и снимает таймер,
// чтобы остановка клиента не оставляла подвисших setTimeout.
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
