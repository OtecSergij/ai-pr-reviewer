import { MAX_ISSUE_BODY } from "@/lib/review/model-issue.schema";
import type { ModelIssue } from "@/lib/review/model-issue.schema";

function bodyAtMaxLength(lead: string, filler: string): string {
  const repeats = Math.ceil((MAX_ISSUE_BODY - lead.length) / filler.length);
  return (lead + filler.repeat(Math.max(repeats, 1))).slice(0, MAX_ISSUE_BODY);
}

export const mockModelIssues: ModelIssue[] = [
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
  {
    file: "test/test.js",
    line_start: 61,
    line_end: 61,
    severity: "nit",
    title: 'describe label says "long string" but the block mostly tests abbreviations',
    body: "`'17 msecs'`, `'1 sec'`, `'1 min'`, `'1 hr'` are abbreviations, not long units. A failing test in this block would point at the wrong place — consider renaming or splitting it.",
  },
];

export const richModelIssues: ModelIssue[] = [
  {
    file: "index.js",
    line_start: 74,
    line_end: 77,
    severity: "error",
    title: "`parse()` returns `undefined` on unmatched input, so `ms()` yields `NaN`",
    body: "`parse` produces a number only when the regex matches. Any other input falls through to an implicit `undefined`, which the caller then multiplies:\n\n| input | current result | expected |\n| --- | --- | --- |\n| `'100'` | `100` | `100` |\n| `'1 fortnight'` | `undefined` | throws |\n| `''` | `undefined` | throws |\n\nA timer built from `NaN` fires on the next tick, so the failure surfaces far away from the bad input that caused it.",
    suggestion:
      "```js\nif (!match) {\n  throw new TypeError('ms(): unsupported value ' + JSON.stringify(str));\n}\n```",
  },
  {
    file: "index.js",
    line_start: 74,
    line_end: 75,
    severity: "warning",
    title: "The alias list in `parse` and the one in `fmtLong` can drift apart",
    body: bodyAtMaxLength(
      "The regex above and the `switch` below enumerate the same unit aliases, and nothing ties the two lists together. ",
      "Adding a unit therefore means editing two places that no test compares, and a reviewer has no mechanical way to see that only one of them was updated. "
    ),
    suggestion:
      "Derive the `switch` from a single `UNITS` table so the pattern and the multipliers cannot disagree.",
  },
  {
    file: "index.js",
    line_start: 76,
    line_end: 77,
    severity: "nit",
    title: "Millisecond constants are re-derived by hand in three places",
    body: "`1000`, `60000` and `3600000` appear as literals here and again in `fmtLong`. Deriving each unit from the previous one (`var m = s * 60`) reads closer to how the units relate.",
  },
  {
    file: "test/test.js",
    line_start: 61,
    line_end: 61,
    severity: "suggestion",
    title: "No regression test covers the alias this PR adds",
    body: "The new alias is exercised only indirectly through the long-format block. A direct assertion would fail loudly if the alias is dropped from the regex later.",
    suggestion:
      "Add `expect(ms('1 week')).to.be(604800000)` next to the existing abbreviation assertions.",
  },
  {
    file: "README.md",
    line_start: 1,
    line_end: 4,
    severity: "warning",
    title: "The documented unit table no longer matches the parser",
    body: "The table lists the units the parser accepted before this PR. Readers copy these strings verbatim, so a missing row here becomes a runtime `undefined` for them.",
    suggestion: "Add the new alias to the table in the same row as its unit.",
  },
];
