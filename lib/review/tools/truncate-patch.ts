const PATCH_CAP = 4_000;

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

export const truncatePatch = (patch: string) => {
  if (patch.length <= PATCH_CAP) {
    return { patch, patchTruncated: false };
  }

  const kept: string[] = [];
  let size = 0;

  for (const hunk of splitHunks(patch)) {
    const nextSize = kept.length === 0 ? hunk.length : size + 1 + hunk.length;

    if (nextSize > PATCH_CAP) break;

    kept.push(hunk);
    size = nextSize;
  }

  return { patch: kept.join("\n"), patchTruncated: true };
};
