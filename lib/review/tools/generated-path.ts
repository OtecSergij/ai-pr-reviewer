const GENERATED_DIRS = new Set([
  "dist",
  "build",
  "out",
  "vendor",
  "node_modules",
  "coverage",
  ".next",
]);

const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
  "go.sum",
]);

const GENERATED_FILE = /\.min\.(js|css)$|\.map$/;

export const isGeneratedPath = (filename: string): boolean => {
  const segments = filename.split("/");
  const basename = segments[segments.length - 1];
  const dirs = segments.slice(0, -1);

  return (
    dirs.some((segment) => GENERATED_DIRS.has(segment)) ||
    LOCKFILES.has(basename) ||
    GENERATED_FILE.test(basename)
  );
};
