export const GITHUB_TIMEOUT_MS = 15_000;

export const TIMEOUT_ERROR_NAME = "TimeoutError";

function timeoutAbortReason(timeoutMs: number): DOMException {
  return new DOMException(
    `GitHub sent no response headers within ${timeoutMs}ms`,
    TIMEOUT_ERROR_NAME
  );
}

export function timeboxedFetch(
  timeoutMs: number = GITHUB_TIMEOUT_MS
): typeof fetch {
  return async (input, init) => {
    const external = init?.signal ?? null;
    const timeout = new AbortController();
    const timer = setTimeout(
      () => timeout.abort(timeoutAbortReason(timeoutMs)),
      timeoutMs
    );
    const signal = external
      ? AbortSignal.any([external, timeout.signal])
      : timeout.signal;

    try {
      return await fetch(input, { ...init, signal });
    } finally {
      clearTimeout(timer);
    }
  };
}
