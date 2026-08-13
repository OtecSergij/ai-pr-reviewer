import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { redis, ensureRedisConnection } from "@/lib/redis";
import { logger } from "@/lib/log";
import { withTimeout } from "@/lib/with-timeout";

const CHECK_TIMEOUT_MS = 2_000;
const CHECK_NAMES = ["postgres", "redis"] as const;

export async function GET(): Promise<Response> {
  const checks = await Promise.allSettled([
    withTimeout(
      db.execute(sql`select 1`),
      CHECK_TIMEOUT_MS,
      "postgres readiness check timed out",
    ),
    withTimeout(
      ensureRedisConnection().then(() => redis.ping()),
      CHECK_TIMEOUT_MS,
      "redis readiness check timed out",
    ),
  ]);

  const failed = checks.flatMap((check, index) =>
    check.status === "rejected"
      ? [{ name: CHECK_NAMES[index], reason: check.reason }]
      : [],
  );

  for (const { name, reason } of failed) {
    logger.error(
      { component: "health", check: name, err: reason },
      "readiness check failed",
    );
  }

  return new Response(null, { status: failed.length === 0 ? 200 : 503 });
}
