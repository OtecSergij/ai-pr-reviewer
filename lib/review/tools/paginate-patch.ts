import { PATCH_PART_CHARS } from "@/lib/review/config";

const splitHunks = (patch: string): string[] => {
  const hunks: string[] = [];

  for (const line of patch.split("\n")) {
    if (hunks.length === 0 || line.startsWith("@@")) {
      hunks.push(line);
    } else {
      hunks[hunks.length - 1] += `\n${line}`;
    }
  }

  return hunks;
};

const pack = (units: string[], cap: number): string[] => {
  const parts: string[] = [];
  let kept: string[] = [];
  let size = 0;

  for (const unit of units) {
    const nextSize = kept.length === 0 ? unit.length : size + 1 + unit.length;

    if (kept.length > 0 && nextSize > cap) {
      parts.push(kept.join("\n"));
      kept = [unit];
      size = unit.length;
      continue;
    }

    kept.push(unit);
    size = nextSize;
  }

  if (kept.length > 0) {
    parts.push(kept.join("\n"));
  }

  return parts;
};

const splitHunk = (hunk: string, cap: number): string[] => {
  const [header, ...body] = hunk.split("\n");
  if (body.length === 0) return [header];

  const [first = "", ...rest] = pack(
    body,
    Math.max(1, cap - header.length - 1),
  );

  return [`${header}\n${first}`, ...rest];
};

export const splitPatch = (
  patch: string,
  cap: number = PATCH_PART_CHARS,
): string[] =>
  pack(
    splitHunks(patch).flatMap((hunk) =>
      hunk.length <= cap ? [hunk] : splitHunk(hunk, cap),
    ),
    cap,
  );
