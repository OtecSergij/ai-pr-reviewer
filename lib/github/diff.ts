export type DiffLineType = "added" | "removed" | "context";

export type DiffLine = {
  kind: DiffLineType;
  content: string;
  oldLineno: number | null;
  newLineno: number | null;
};

export type Hunk = { newStart: number; newEnd: number; lines: DiffLine[] };

const headRegexp = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  const lines = patch.split("\n");

  let current: Hunk | null = null;
  let currentOld: number = 0;
  let currentNew: number = 0;

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  for (const line of lines) {
    const start = line[0];

    if (start === "@") {
      const result = headRegexp.exec(line);

      if (!result) {
        throw new Error(`malformed hunk header: ${JSON.stringify(line)}`);
      }

      const oldStart = Number(result[1]);
      const newStart = Number(result[3]);
      const newCount = Number(result[4] ?? "1");

      const hunk: Hunk = {
        lines: [],
        newEnd: newStart + newCount - 1,
        newStart,
      };

      hunks.push(hunk);

      current = hunk;
      currentOld = oldStart;
      currentNew = newStart;
      continue;
    } else if (start === "\\") {
      continue;
    } else if (!current) {
      throw new Error(`diff line before hunk header: ${JSON.stringify(line)}`);
    } else if (start === "+") {
      current.lines.push({
        kind: "added",
        content: line.slice(1).replace(/\r$/, ""),
        newLineno: currentNew++,
        oldLineno: null,
      });
    } else if (start === "-") {
      current.lines.push({
        kind: "removed",
        content: line.slice(1).replace(/\r$/, ""),
        newLineno: null,
        oldLineno: currentOld++,
      });
    } else {
      current.lines.push({
        kind: "context",
        content: line.slice(1).replace(/\r$/, ""),
        newLineno: currentNew++,
        oldLineno: currentOld++,
      });
    }
  }

  return hunks;
}
