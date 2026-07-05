import "server-only";
import { createClient } from "redis";
import { env } from "@/lib/env";

type RedisClient = ReturnType<typeof createClient>;

function buildClient(): RedisClient {
  const client = createClient({
    url: env.REDIS_URL,
    disableOfflineQueue: true,
  });
  client.on("error", () => {});
  return client;
}

export const redis: RedisClient = buildClient();

let connecting: Promise<void> | null = null;

export function ensureRedisConnection(): void {
  if (redis.isOpen || connecting) return;
  connecting = redis
    .connect()
    .then(() => {})
    .catch(() => {})
    .finally(() => {
      connecting = null;
    });
}
