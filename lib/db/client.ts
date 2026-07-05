import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";

export const db = drizzle(postgres(env.DATABASE_URL, { connect_timeout: 5 }));
