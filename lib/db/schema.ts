import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import type { Issue } from "@/lib/review/issue";

export const reviews = pgTable("reviews", {
  slug: text("slug").primaryKey(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  prNumber: integer("pr_number").notNull(),
  headSha: text("head_sha").notNull(),
  prTitle: text("pr_title").notNull(),
  issues: jsonb("issues").$type<Issue[]>().notNull(),
  provider: text("provider").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type ReviewRow = typeof reviews.$inferSelect;
