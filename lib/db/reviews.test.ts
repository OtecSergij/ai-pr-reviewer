import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { reviews, type ReviewRow } from "@/lib/db/schema";
import type { ReviewIdentity } from "./slug";

type InsertCall = { table: unknown; values: unknown; conflict: unknown };
type SelectCall = { table: unknown; where: unknown; limit: unknown };

const insertCalls: InsertCall[] = [];
const selectCalls: SelectCall[] = [];
const insertResult = vi.fn<() => Promise<unknown>>();
const selectResult = vi.fn<() => Promise<ReviewRow[]>>();

vi.mock("@/lib/db/client", () => ({
  db: {
    insert(table: unknown) {
      const call: InsertCall = {
        table,
        values: undefined,
        conflict: undefined,
      };
      insertCalls.push(call);
      return {
        values(values: unknown) {
          call.values = values;
          return {
            onConflictDoUpdate(conflict: unknown) {
              call.conflict = conflict;
              return insertResult();
            },
          };
        },
      };
    },
    select() {
      const call: SelectCall = {
        table: undefined,
        where: undefined,
        limit: undefined,
      };
      selectCalls.push(call);
      return {
        from(table: unknown) {
          call.table = table;
          return {
            where(where: unknown) {
              call.where = where;
              return {
                limit(limit: unknown) {
                  call.limit = limit;
                  return selectResult();
                },
              };
            },
          };
        },
      };
    },
  },
}));

const { saveReview, getReview } = await import("./reviews");

const identity: ReviewIdentity = {
  owner: "Vercel",
  repo: "Next.js",
  prNumber: 123,
  headSha: "ABCDEF0",
};

const input = {
  ...identity,
  prTitle: "Fix the thing",
  issues: [],
  modelId: "gemini-2.5-flash",
};

const row: ReviewRow = {
  slug: "0T6rLUpSmg3",
  owner: "vercel",
  repo: "next.js",
  prNumber: 123,
  headSha: "abcdef0",
  prTitle: "Fix the thing",
  issues: [],
  modelId: "gemini-2.5-flash",
  createdAt: new Date("2026-08-12T00:00:00Z"),
};

const log = { info: vi.fn() } as unknown as Logger;

beforeEach(() => {
  insertCalls.length = 0;
  selectCalls.length = 0;
  insertResult.mockReset();
  selectResult.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saveReview", () => {
  it("upserts on the slug so a re-review of the same head sha overwrites", async () => {
    insertResult.mockResolvedValue(undefined);

    await expect(saveReview(input, log)).resolves.toBe("0T6rLUpSmg3");

    expect(insertCalls).toHaveLength(1);
    const { table, values, conflict } = insertCalls[0];
    expect(table).toBe(reviews);
    expect(values).toEqual({
      slug: "0T6rLUpSmg3",
      owner: "Vercel",
      repo: "Next.js",
      prNumber: 123,
      headSha: "ABCDEF0",
      prTitle: "Fix the thing",
      issues: [],
      modelId: "gemini-2.5-flash",
    });

    const { target, set } = conflict as { target: unknown; set: unknown };
    expect(target).toBe(reviews.slug);
    expect(set).toEqual({
      owner: "Vercel",
      repo: "Next.js",
      prTitle: "Fix the thing",
      issues: [],
      modelId: "gemini-2.5-flash",
      createdAt: sql`now()`,
    });
  });

  it("holds the insert for its full budget and then gives up on it", async () => {
    insertResult.mockReturnValue(new Promise(() => {}));
    const outcome = vi.fn();
    const pending = saveReview(input, log).catch(outcome);

    await vi.advanceTimersByTimeAsync(3_499);
    expect(outcome).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(outcome).toHaveBeenCalledWith(new Error("review save timed out"));
  });
});

describe("getReview", () => {
  it("returns the single matching row", async () => {
    selectResult.mockResolvedValue([row]);

    await expect(getReview("0T6rLUpSmg3")).resolves.toBe(row);

    expect(selectCalls).toHaveLength(1);
    const { table, where, limit } = selectCalls[0];
    expect(table).toBe(reviews);
    expect(where).toEqual(eq(reviews.slug, "0T6rLUpSmg3"));
    expect(limit).toBe(1);
  });

  it("returns null when no row matches", async () => {
    selectResult.mockResolvedValue([]);

    await expect(getReview("0T6rLUpSmg3")).resolves.toBeNull();
  });

  it("holds the lookup for its full budget and then gives up on it", async () => {
    selectResult.mockReturnValue(new Promise(() => {}));
    const outcome = vi.fn();
    const pending = getReview("0T6rLUpSmg3").catch(outcome);

    await vi.advanceTimersByTimeAsync(3_499);
    expect(outcome).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(outcome).toHaveBeenCalledWith(new Error("review lookup timed out"));
  });
});
