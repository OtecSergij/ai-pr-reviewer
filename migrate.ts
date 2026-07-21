import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const MIGRATION_LOCK_KEY = 4_027_913_500_112;

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

const sql = postgres(url, { max: 1 });

try {
  await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  } finally {
    await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
  }
} catch (error) {
  process.exitCode = 1;
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
