import { z } from "zod";
import { runReview } from "@/lib/review/run-review";
import {
  getClientIp,
  rateLimitResponse,
  requestLimiter,
} from "@/lib/rate-limit";
import { errorToMessage } from "@/lib/review/errors";
import type { ErrorKind } from "@/lib/review/transcript";
import { validRequestId } from "@/lib/request-id";
import { logger } from "@/lib/log";

const requestSchema = z.object({
  prUrl: z.string().min(1).max(2048),
  anthropicKey: z.string().min(1).max(200).optional(),
  githubPat: z.string().min(1).max(255).optional(),
});

export async function POST(req: Request) {
  const requestId =
    validRequestId(req.headers.get("x-request-id")) ?? crypto.randomUUID();
  const log = logger.child({ requestId });

  const ip = getClientIp(req);

  const gate = await requestLimiter.check(ip);
  if (!gate.allowed) {
    log.info(
      { ip, retryAfterMs: gate.retryAfterMs },
      "request rejected: rate limited",
    );
    const res = rateLimitResponse(gate);
    res.headers.set("x-request-id", requestId);
    return res;
  }

  const contentType = req.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("application/json")) {
    log.warn({ contentType }, "rejected: unsupported content type");
    return new Response("Unsupported content type: send application/json.", {
      status: 415,
      headers: {
        "x-request-id": requestId,
        "x-review-error": "load" satisfies ErrorKind,
      },
    });
  }

  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    log.warn("rejected: invalid request body");
    return new Response(
      "Invalid request body: expected { prUrl: string, anthropicKey?: string, githubPat?: string }",
      {
        status: 400,
        headers: {
          "x-request-id": requestId,
          "x-review-error": "load" satisfies ErrorKind,
        },
      },
    );
  }

  log.info(
    {
      ip,
      prUrl: parsed.data.prUrl,
      hasByoKey: Boolean(parsed.data.anthropicKey),
      hasGithubPat: Boolean(parsed.data.githubPat),
    },
    "review requested",
  );

  try {
    const res = await runReview({
      prUrl: parsed.data.prUrl,
      signal: req.signal,
      anthropicKey: parsed.data.anthropicKey,
      githubPat: parsed.data.githubPat,
      ip,
      requestId,
    });
    res.headers.set("x-request-id", requestId);
    return res;
  } catch (e) {
    log.error({ err: e }, "review request failed before the stream");
    return new Response(errorToMessage(e), {
      status: 500,
      headers: {
        "x-request-id": requestId,
        "x-review-error": "review" satisfies ErrorKind,
      },
    });
  }
}
