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

export const splitPatch = (
  patch: string,
  cap: number = PATCH_PART_CHARS
): string[] => {
  const parts: string[] = [];
  let kept: string[] = [];
  let size = 0;

  for (const hunk of splitHunks(patch)) {
    const nextSize = kept.length === 0 ? hunk.length : size + 1 + hunk.length;

    if (kept.length > 0 && nextSize > cap) {
      parts.push(kept.join("\n"));
      kept = [hunk];
      size = hunk.length;
      continue;
    }

    kept.push(hunk);
    size = nextSize;
  }

  if (kept.length > 0) {
    parts.push(kept.join("\n"));
  }

  return parts;
};
