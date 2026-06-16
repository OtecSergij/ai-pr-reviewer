import { z } from "zod";
import { runReview } from "@/lib/review/run-review";

const requestSchema = z.object({
  prUrl: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return new Response("Invalid request body: expected { prUrl: string }", {
      status: 400,
    });
  }

  return runReview(parsed.data.prUrl, req.signal);
}
