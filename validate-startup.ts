import postgres from "postgres";
import { createClient } from "redis";
import { assertEnv, env } from "./lib/env";

const CHECK_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} startup check timed out`)),
      CHECK_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main(): Promise<void> {
  assertEnv();

  const sql = postgres(env.DATABASE_URL, { max: 1 });
  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", () => {});

  try {
    await withTimeout(sql`select 1`, "postgres");
    await withTimeout(redis.connect().then(() => redis.ping()), "redis");
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
    if (redis.isOpen) {
      await redis.close().catch(() => {});
    }
  }
}

await main();
