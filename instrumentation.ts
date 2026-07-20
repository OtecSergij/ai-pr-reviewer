import { type Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : undefined;
  const { logger } = await import("@/lib/log");
  logger.error(
    {
      err: error,
      digest,
      requestId: request.headers["x-request-id"],
      path: request.path,
      method: request.method,
      routeType: context.routeType,
    },
    "unhandled request error"
  );
};
