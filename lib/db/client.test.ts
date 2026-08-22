import { describe, it, expect, vi } from "vitest";

const { poolCalls } = vi.hoisted(() => ({
  poolCalls: [] as { url: unknown; options: unknown }[],
}));

vi.mock("postgres", () => ({
  default: (url: unknown, options: unknown) => {
    poolCalls.push({ url, options });
    return {};
  },
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: (client: unknown) => client,
}));

vi.mock("@/lib/env", () => ({
  env: { DATABASE_URL: "postgres://mock:mock@localhost:5432/mock" },
}));

await import("@/lib/db/client");

describe("db pool", () => {
  it("pins the pool connect and statement budgets", () => {
    expect(poolCalls).toHaveLength(1);
    expect(poolCalls[0].url).toBe("postgres://mock:mock@localhost:5432/mock");
    expect(poolCalls[0].options).toStrictEqual({
      connect_timeout: 1,
      connection: { statement_timeout: 1000 },
    });
  });
});
