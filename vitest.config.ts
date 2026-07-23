import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${rootDir}/$1` },
      { find: "server-only", replacement: `${rootDir}/test/server-only.ts` },
    ],
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
