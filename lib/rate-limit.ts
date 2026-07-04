import "server-only";
import { redis, ensureRedisConnection } from "@/lib/redis";
import { env } from "@/lib/env";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const EVAL_TIMEOUT_MS = 500;

type Tier = {
  label: string;
  limit: number;
  windowMs: number;
};

export type RateLimitGate =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

const CHECK_AND_CONSUME = `
local now = tonumber(ARGV[1])
local blocked = 0
local retryAfter = 0
for i = 1, #KEYS do
  local window = tonumber(ARGV[2 * i + 1])
  local limit = tonumber(ARGV[2 * i + 2])
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - window)
  local count = redis.call('ZCARD', KEYS[i])
  if count >= limit then
    local idx = count - limit
    local entry = redis.call('ZRANGE', KEYS[i], idx, idx, 'WITHSCORES')
    local wait = tonumber(entry[2]) + window - now
    if wait > retryAfter then
      retryAfter = wait
      blocked = i
    end
  end
end
if blocked > 0 then
  return {0, blocked, retryAfter}
end
for i = 1, #KEYS do
  redis.call('ZADD', KEYS[i], now, ARGV[2])
  redis.call('PEXPIRE', KEYS[i], ARGV[2 * i + 1])
end
return {1, 0, 0}
`;

function createRateLimiter(prefix: string, tiers: Tier[]) {
  return {
    async check(id: string): Promise<RateLimitGate> {
      try {
        ensureRedisConnection();
        if (!redis.isReady) return { allowed: true };

        const reply = (await Promise.race([
          redis.eval(CHECK_AND_CONSUME, {
            keys: tiers.map((tier) => `${prefix}:${tier.label}:${id}`),
            arguments: [
              String(Date.now()),
              crypto.randomUUID(),
              ...tiers.flatMap((tier) => [
                String(tier.windowMs),
                String(tier.limit),
              ]),
            ],
          }),
          timeoutAfter(EVAL_TIMEOUT_MS),
        ])) as [number, number, number];

        const [allowed, , retryAfterMs] = reply;
        if (allowed === 1) return { allowed: true };

        return { allowed: false, retryAfterMs };
      } catch {
        return { allowed: true };
      }
    },
  };
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(reject, ms, new Error("rate limiter timed out"));
  });
}

function formatWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.ceil(minutes / 60)} h`;
}

export function rateLimitResponse(
  gate: Extract<RateLimitGate, { allowed: false }>
): Response {
  return new Response(`Try again in ~${formatWait(gate.retryAfterMs)}.`, {
    status: 429,
    headers: { "retry-after": String(Math.ceil(gate.retryAfterMs / 1000)) },
  });
}

export function getClientIp(req: Request): string {
  if (!env.TRUST_PROXY) return "dev";
  const xff = req.headers.get("x-forwarded-for");
  const last = xff?.split(",").at(-1)?.trim().toLowerCase();
  return last || "unknown";
}

export const requestLimiter = createRateLimiter("rl:req", [
  { label: "hour", limit: 25, windowMs: HOUR_MS },
]);

export const reviewLimiter = createRateLimiter("rl:review", [
  { label: "hour", limit: 3, windowMs: HOUR_MS },
  { label: "day", limit: 10, windowMs: DAY_MS },
]);
