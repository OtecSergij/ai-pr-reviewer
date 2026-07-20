import "server-only";
import pino from "pino";

const SENSITIVE_ERR_KEYS = new Set(["requestBodyValues", "responseBody"]);

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
    copy[key] = redact(record[key], seen);
  }
  return copy;
}

function sanitizeError(err: Error) {
  return redact(pino.stdSerializers.err(err), new WeakMap());
}

export const logger = pino({
  serializers: { err: sanitizeError },
});
