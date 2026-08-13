import postgres from "postgres";
import { createClient } from "redis";
import { assertEnv, env } from "./lib/env";
import { withTimeout } from "./lib/with-timeout";

const CHECK_TIMEOUT_MS = 5_000;

async function main(): Promise<void> {
  assertEnv();

  const sql = postgres(env.DATABASE_URL, { max: 1 });
  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", () => {});

  try {
    await withTimeout(
      sql`select 1`,
      CHECK_TIMEOUT_MS,
      "postgres startup check timed out",
    );
    await withTimeout(
      redis.connect().then(() => redis.ping()),
      CHECK_TIMEOUT_MS,
      "redis startup check timed out",
    );
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
    if (redis.isOpen) {
      await redis.close().catch(() => {});
    }
  }
}

await main();
