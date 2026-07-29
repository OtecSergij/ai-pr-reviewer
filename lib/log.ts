import "server-only";
import pino from "pino";

const SENSITIVE_ERR_KEYS = new Set(["requestBodyValues", "responseBody"]);

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "api-key",
  "x-api-key",
  "x-goog-api-key",
]);

const PRETTY_TRANSPORT = {
  target: "pino-pretty",
  options: {
    translateTime: "SYS:HH:MM:ss.l",
    ignore: "pid,hostname",
  },
};

function redact(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(redact(item, seen));
    return copy;
  }

  const record = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const key of Object.keys(record)) {
    if (SENSITIVE_ERR_KEYS.has(key)) continue;
    if (SENSITIVE_HEADER_KEYS.has(key.toLowerCase())) continue;
    copy[key] = redact(record[key], seen);
  }
  return copy;
}

function sanitizeError(err: Error) {
  return redact(pino.stdSerializers.err(err), new WeakMap());
}

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: isProduction ? "info" : "debug",
  serializers: { err: sanitizeError },
  transport: isProduction ? undefined : PRETTY_TRANSPORT,
});
