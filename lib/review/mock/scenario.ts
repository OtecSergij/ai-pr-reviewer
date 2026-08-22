import type { FinishReason } from "ai";

import type { env } from "@/lib/env";
import { REVIEW_TOOL_NAMES } from "@/lib/review/tools/tool-names";
import type { ReviewToolName } from "@/lib/review/tools/tool-names";
import type { ModelIssue } from "@/lib/review/model-issue.schema";
import { mockModelIssues, richModelIssues } from "@/lib/review/mock/issues";

export type MockTextBlock = {
  id: string;
  deltas: string[];
};

export type MockToolStep = {
  kind: "tool";
  toolCallId: string;
  toolName: ReviewToolName;
  input: unknown;
};

export type MockStep =
  | ({ kind: "text" } & MockTextBlock)
  | ({ kind: "reasoning" } & MockTextBlock)
  | { kind: "interleaved-text"; first: MockTextBlock; second: MockTextBlock }
  | MockToolStep;

export type MockScenario = {
  steps: MockStep[];
  finishReason: FinishReason;
};

export type MockIdScope = (fixtureId: string) => string;

type ScenarioName = NonNullable<typeof env.MOCK_SCENARIO>;

const textStep = (id: string, deltas: string[]): MockStep => ({
  kind: "text",
  id,
  deltas,
});

const reasoningStep = (id: string, deltas: string[]): MockStep => ({
  kind: "reasoning",
  id,
  deltas,
});

const metadataStep = (toolCallId: string): MockStep => ({
  kind: "tool",
  toolCallId,
  toolName: REVIEW_TOOL_NAMES.getPrMetadata,
  input: {},
});

const filesStep = (toolCallId: string): MockStep => ({
  kind: "tool",
  toolCallId,
  toolName: REVIEW_TOOL_NAMES.getPrFilesSummary,
  input: {},
});

const diffStep = (toolCallId: string, filename: string): MockStep => ({
  kind: "tool",
  toolCallId,
  toolName: REVIEW_TOOL_NAMES.getDiff,
  input: { filename },
});

const contentsStep = (toolCallId: string, path: string): MockStep => ({
  kind: "tool",
  toolCallId,
  toolName: REVIEW_TOOL_NAMES.getFileContents,
  input: { path },
});

const directoryStep = (toolCallId: string, path: string): MockStep => ({
  kind: "tool",
  toolCallId,
  toolName: REVIEW_TOOL_NAMES.listDirectory,
  input: { path },
});

const issueStep = (toolCallId: string, issue: ModelIssue): MockStep => ({
  kind: "tool",
  toolCallId,
  toolName: REVIEW_TOOL_NAMES.emitIssue,
  input: issue,
});

const defaultScenario: MockScenario = {
  steps: [
    textStep("mock-text-1", [
      "Taking a look at this PR. ",
      "First the metadata — ",
      "title, description, scope — ",
      "then the changed files.",
    ]),
    metadataStep("mock-call-1"),
    filesStep("mock-call-2"),
    textStep("mock-text-2", [
      "Three files changed: ",
      "`index.js`, `test/test.js` and `README.md`. ",
      "The parser change in `index.js` is the core of the PR — ",
      "reading its diff first.",
    ]),
    diffStep("mock-call-3", "index.js"),
    issueStep("mock-call-4", mockModelIssues[0]),
    textStep("mock-text-3", [
      "The unit table in `parse` is worth flagging. ",
      "Now checking the new tests ",
      "in `test/test.js`.",
    ]),
    diffStep("mock-call-5", "test/test.js"),
    issueStep("mock-call-6", mockModelIssues[1]),
    textStep("mock-text-4", ["Review complete."]),
  ],
  finishReason: "stop",
};

const cleanScenario: MockScenario = {
  steps: [
    textStep("clean-text-1", [
      "Reading the PR before judging it. ",
      "Metadata first, then every diff.",
    ]),
    metadataStep("clean-call-1"),
    filesStep("clean-call-2"),
    diffStep("clean-call-3", "index.js"),
    diffStep("clean-call-4", "test/test.js"),
    diffStep("clean-call-5", "README.md"),
    textStep("clean-text-2", ["No issues found."]),
  ],
  finishReason: "stop",
};

const richScenario: MockScenario = {
  steps: [
    textStep("rich-text-1", [
      "Starting with the metadata, ",
      "then reading `index.js` closely — ",
      "the parser is where the risk is.",
    ]),
    metadataStep("rich-call-1"),
    filesStep("rich-call-2"),
    diffStep("rich-call-3", "index.js"),
    contentsStep("rich-call-4", "index.js"),
    issueStep("rich-call-5", richModelIssues[0]),
    issueStep("rich-call-6", richModelIssues[1]),
    issueStep("rich-call-7", richModelIssues[2]),
    textStep("rich-text-2", [
      "Three findings in `index.js`. ",
      "Moving on to the tests and the README.",
    ]),
    diffStep("rich-call-8", "test/test.js"),
    issueStep("rich-call-9", richModelIssues[3]),
    diffStep("rich-call-10", "README.md"),
    issueStep("rich-call-11", richModelIssues[4]),
    textStep("rich-text-3", ["Review complete."]),
  ],
  finishReason: "stop",
};

const duplicateScenario: MockScenario = {
  steps: [
    textStep("duplicate-text-1", [
      "Reading `index.js`, ",
      "then reporting what I find.",
    ]),
    metadataStep("duplicate-call-1"),
    filesStep("duplicate-call-2"),
    diffStep("duplicate-call-3", "index.js"),
    issueStep("duplicate-call-4", mockModelIssues[0]),
    textStep("duplicate-text-2", [
      "Re-reading the same hunk to be sure ",
      "I did not misread the alias list.",
    ]),
    diffStep("duplicate-call-5", "index.js"),
    issueStep("duplicate-call-6", mockModelIssues[0]),
    textStep("duplicate-text-3", ["Review complete."]),
  ],
  finishReason: "stop",
};

const longScenario: MockScenario = {
  steps: [
    textStep("long-text-1", [
      "This one deserves a full pass: ",
      "metadata, every diff, ",
      "and the surrounding files the diffs depend on.",
    ]),
    metadataStep("long-call-1"),
    filesStep("long-call-2"),
    directoryStep("long-call-3", ""),
    diffStep("long-call-4", "index.js"),
    contentsStep("long-call-5", "index.js"),
    diffStep("long-call-6", "test/test.js"),
    directoryStep("long-call-7", "test"),
    contentsStep("long-call-8", "test/test.js"),
    textStep("long-text-2", [
      "The parser and its tests are clear now. ",
      "Checking how the package documents these units.",
    ]),
    diffStep("long-call-9", "README.md"),
    contentsStep("long-call-10", "package.json"),
    contentsStep("long-call-11", "README.md"),
    directoryStep("long-call-12", "lib"),
    contentsStep("long-call-13", "src/parse.ts"),
    issueStep("long-call-14", mockModelIssues[0]),
    textStep("long-text-3", [
      "One issue so far. ",
      "Going back over the diffs to check the alias table ",
      "against every call site.",
    ]),
    diffStep("long-call-15", "index.js"),
    contentsStep("long-call-16", "index.js"),
    diffStep("long-call-17", "test/test.js"),
    directoryStep("long-call-18", "test"),
    diffStep("long-call-19", "README.md"),
    contentsStep("long-call-20", "package.json"),
    issueStep("long-call-21", mockModelIssues[1]),
    textStep("long-text-4", [
      "Last sweep: ",
      "re-reading the parser hunk once more ",
      "before summarising.",
    ]),
    diffStep("long-call-22", "index.js"),
    contentsStep("long-call-23", "license.md"),
    directoryStep("long-call-24", ""),
    diffStep("long-call-25", "test/test.js"),
    contentsStep("long-call-26", "index.js"),
    diffStep("long-call-27", "README.md"),
    contentsStep("long-call-28", "test/test.js"),
    issueStep("long-call-29", richModelIssues[2]),
    textStep("long-text-5", ["Review complete."]),
  ],
  finishReason: "stop",
};

const interleavedTextScenario: MockScenario = {
  steps: [
    metadataStep("interleaved-call-1"),
    filesStep("interleaved-call-2"),
    {
      kind: "interleaved-text",
      first: {
        id: "interleaved-text-a",
        deltas: [
          "Reading `index.js`: ",
          "the regex gained a unit, ",
          "the switch gained a case.",
        ],
      },
      second: {
        id: "interleaved-text-b",
        deltas: [
          "Reading `test/test.js`: ",
          "the new assertions cover the abbreviation, ",
          "not the long form.",
        ],
      },
    },
    diffStep("interleaved-call-3", "index.js"),
    issueStep("interleaved-call-4", mockModelIssues[0]),
    textStep("interleaved-text-1", ["Review complete."]),
  ],
  finishReason: "stop",
};

const reasoningScenario: MockScenario = {
  steps: [
    reasoningStep("reasoning-block-1", [
      "The PR touches a parser, ",
      "so the risk is in inputs that no test covers. ",
      "Read the diff before the tests.",
    ]),
    textStep("reasoning-text-1", [
      "Starting with the metadata ",
      "and the list of changed files.",
    ]),
    metadataStep("reasoning-call-1"),
    filesStep("reasoning-call-2"),
    reasoningStep("reasoning-block-2", [
      "Three files. ",
      "`index.js` carries the behaviour; ",
      "the other two only describe it. ",
      "The regex and the switch enumerate the same unit aliases, ",
      "so the first thing to check is whether the two lists still agree ",
      "after this change — a unit added to one side but not the other ",
      "would make `parse` return undefined for input the regex accepts. ",
      "The tests only cover abbreviations, so a drift like that ",
      "would not fail CI; it would surface as a silent NaN ",
      "in whatever timer the caller builds from the result. ",
      "Reading the diff hunk around the alias table first, ",
      "then cross-checking the switch below it.",
    ]),
    diffStep("reasoning-call-3", "index.js"),
    issueStep("reasoning-call-4", mockModelIssues[0]),
    textStep("reasoning-text-2", ["Review complete."]),
  ],
  finishReason: "stop",
};

const finishLengthScenario: MockScenario = {
  steps: [
    textStep("length-text-1", [
      "Reading the parser change first, ",
      "then the tests.",
    ]),
    metadataStep("length-call-1"),
    filesStep("length-call-2"),
    diffStep("length-call-3", "index.js"),
    issueStep("length-call-4", mockModelIssues[0]),
    textStep("length-text-2", [
      "That is the first issue. ",
      "The second one is in `test/test.js`, where the describe label ",
      "no longer matches the assertions it",
    ]),
  ],
  finishReason: "length",
};

const finishLengthReadAllScenario: MockScenario = {
  steps: [
    textStep("read-all-text-1", [
      "Reading every changed file ",
      "before judging any of them.",
    ]),
    metadataStep("read-all-call-1"),
    filesStep("read-all-call-2"),
    diffStep("read-all-call-3", "index.js"),
    diffStep("read-all-call-4", "test/test.js"),
    diffStep("read-all-call-5", "README.md"),
    issueStep("read-all-call-6", mockModelIssues[0]),
    textStep("read-all-text-2", [
      "One issue so far. ",
      "The second one is in `test/test.js`, where the describe label ",
      "no longer matches the assertions it",
    ]),
  ],
  finishReason: "length",
};

const SCENARIOS: Record<ScenarioName, MockScenario> = {
  clean: cleanScenario,
  rich: richScenario,
  duplicate: duplicateScenario,
  long: longScenario,
  "interleaved-text": interleavedTextScenario,
  reasoning: reasoningScenario,
  "finish-length": finishLengthScenario,
  "finish-length-read-all": finishLengthReadAllScenario,
};

export function selectScenario(name: ScenarioName | undefined): MockScenario {
  return name ? SCENARIOS[name] : defaultScenario;
}

let streamOrdinal = 0;

export function createMockIdScope(): MockIdScope {
  streamOrdinal += 1;
  const prefix = `s${streamOrdinal}`;
  return (fixtureId) => `${prefix}-${fixtureId}`;
}

export function isIssueStep(step: MockStep): step is MockToolStep {
  return step.kind === "tool" && step.toolName === REVIEW_TOOL_NAMES.emitIssue;
}
