import { z } from "zod";
import { runReview } from "@/lib/review/run-review";
import {
  getClientIp,
  rateLimitResponse,
  requestLimiter,
} from "@/lib/rate-limit";
import { logger } from "@/lib/log";

const requestSchema = z.object({
  prUrl: z.string().min(1).max(2048),
  anthropicKey: z.string().min(1).max(200).optional(),
  githubPat: z.string().min(1).max(255).optional(),
});

const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

export async function POST(req: Request) {
  const incomingRequestId = req.headers.get("x-request-id");
  const requestId =
    incomingRequestId && REQUEST_ID_PATTERN.test(incomingRequestId)
      ? incomingRequestId
      : crypto.randomUUID();
  const log = logger.child({ requestId });

  const ip = getClientIp(req);

  const gate = await requestLimiter.check(ip);
  if (!gate.allowed) {
    log.info({ ip, retryAfterMs: gate.retryAfterMs }, "request rejected: rate limited");
    const res = rateLimitResponse(gate);
    res.headers.set("x-request-id", requestId);
    return res;
  }

  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    log.warn("rejected: invalid request body");
    return new Response(
      "Invalid request body: expected { prUrl: string, anthropicKey?: string, githubPat?: string }",
      { status: 400, headers: { "x-request-id": requestId } }
    );
  }

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
}
