import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

const sql = postgres(url, { max: 1 });

migrate(drizzle(sql), { migrationsFolder: "./drizzle" })
  .catch((error) => {
    process.exitCode = 1;
    throw error;
  })
  .finally(() => sql.end({ timeout: 5 }));
