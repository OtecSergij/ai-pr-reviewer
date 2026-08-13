const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validRequestId(value: unknown): string | undefined {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value)
    ? value
    : undefined;
}
