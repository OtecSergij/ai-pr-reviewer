import "server-only";
import { createClient } from "redis";
import { env } from "@/lib/env";
import { logger } from "@/lib/log";

type RedisClient = ReturnType<typeof createClient>;

const log = logger.child({ component: "redis" });

const CLIENT_ERROR_REPEAT_MS = 30_000;
const CLIENT_ERROR_KEY_LIMIT = 64;

type SocketError = Error & {
  code?: string;
  syscall?: string;
  hostname?: string;
  address?: string;
  port?: number;
};

type SocketErrorDetails = {
  code: string;
  syscall: string | null;
  host: string | null;
  address: string | null;
  port: number | null;
};

type NamedErrorDetails = {
  name: string;
  message: string;
};

type ClientErrorSummary = {
  key: string;
  details: SocketErrorDetails | NamedErrorDetails;
  stackOnFirst: boolean;
};

type ClientErrorWindow = {
  at: number;
  suppressed: number;
};

function socketErrorDetails(error: unknown): SocketErrorDetails | null {
  if (error instanceof AggregateError) {
    return socketErrorDetails(error.errors[0]);
  }
  if (!(error instanceof Error)) return null;
  const { code, syscall, hostname, address, port } = error as SocketError;
  if (!code) return null;
  return {
    code,
    syscall: syscall ?? null,
    host: hostname ?? null,
    address: address ?? null,
    port: port ?? null,
  };
}

function namedErrorDetails(error: unknown): NamedErrorDetails {
  if (!(error instanceof Error)) {
    return { name: "unknown", message: String(error) };
  }
  return { name: error.constructor.name, message: error.message };
}

function summarizeClientError(error: unknown): ClientErrorSummary {
  const socket = socketErrorDetails(error);
  if (socket) {
    return {
      key: `${socket.code}:${socket.host}:${socket.address}:${socket.port}`,
      details: socket,
      stackOnFirst: false,
    };
  }
  const named = namedErrorDetails(error);
  return {
    key: `${named.name}:${named.message}`,
    details: named,
    stackOnFirst: true,
  };
}

function pruneErrorWindows(
  windows: Map<string, ClientErrorWindow>,
  now: number,
): void {
  if (windows.size <= CLIENT_ERROR_KEY_LIMIT) return;
  for (const [key, window] of windows) {
    if (now - window.at >= CLIENT_ERROR_REPEAT_MS) windows.delete(key);
  }
  if (windows.size > CLIENT_ERROR_KEY_LIMIT) windows.clear();
}

function buildClient(): RedisClient {
  const errorWindows = new Map<string, ClientErrorWindow>();

  const client = createClient({
    url: env.REDIS_URL,
    disableOfflineQueue: true,
  });
  client.on("error", (error) => {
    const { key, details, stackOnFirst } = summarizeClientError(error);
    const now = Date.now();
    const open = errorWindows.get(key);

    if (open && now - open.at < CLIENT_ERROR_REPEAT_MS) {
      open.suppressed += 1;
      return;
    }

    log.error(
      stackOnFirst && !open
        ? { err: error, suppressed: 0 }
        : { ...details, suppressed: open?.suppressed ?? 0 },
      "redis client error",
    );

    errorWindows.set(key, { at: now, suppressed: 0 });
    pruneErrorWindows(errorWindows, now);
  });
  return client;
}

export const redis: RedisClient = buildClient();

let connecting: Promise<void> | null = null;

export function ensureRedisConnection(): Promise<void> {
  if (redis.isOpen) return Promise.resolve();
  if (!connecting) {
    connecting = redis
      .connect()
      .then(() => {})
      .catch((error) => {
        log.error({ err: error }, "redis connection attempt failed");
      })
      .finally(() => {
        connecting = null;
      });
  }
  return connecting;
}
