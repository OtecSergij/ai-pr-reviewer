import { z } from "zod";

const EnvSchema = z.object({
  GITHUB_PAT: z.string().min(1),
  CEREBRAS_API_KEY: z.string().min(1),
  GROQ_API_KEY: z.string().min(1).optional(),
  AI_TUNNEL_API_KEY: z.string().min(1),
  MOCK_REVIEW: z
    .string()
    .optional()
    .transform((v) => v === "1"),
  MOCK_ERROR: z
    .enum([
      "api-retryable",
      "retry-exhausted",
      "api-400",
      "load-key",
      "unknown",
      "tool-outcomes",
    ])
    .optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(
    `Invalid or missing environment variables: ${bad}. Check .env.local`,
  );
}

export const env = parsed.data;
