import { z } from "zod";
import { runReview } from "@/lib/review/run-review";
import {
  getClientIp,
  rateLimitResponse,
  requestLimiter,
} from "@/lib/rate-limit";

const requestSchema = z.object({
  prUrl: z.string().min(1),
  anthropicKey: z.string().min(1).optional(),
  githubPat: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);

  const gate = await requestLimiter.check(ip);
  if (!gate.allowed) {
    return rateLimitResponse(gate);
  }

  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return new Response(
      "Invalid request body: expected { prUrl: string, anthropicKey?: string, githubPat?: string }",
      { status: 400 }
    );
  }

  return runReview({
    prUrl: parsed.data.prUrl,
    signal: req.signal,
    anthropicKey: parsed.data.anthropicKey,
    githubPat: parsed.data.githubPat,
    ip,
  });
}
