import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { redis, ensureRedisConnection } from "@/lib/redis";

const CHECK_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} readiness check timed out`)),
      CHECK_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function GET(): Promise<Response> {
  const checks = await Promise.allSettled([
    withTimeout(db.execute(sql`select 1`), "postgres"),
    withTimeout(
      ensureRedisConnection().then(() => redis.ping()),
      "redis",
    ),
  ]);

  const ready = checks.every((check) => check.status === "fulfilled");
  return new Response(null, { status: ready ? 200 : 503 });
}
