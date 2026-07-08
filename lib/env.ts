import { z } from "zod";

const EnvSchema = z.object({
  GITHUB_PAT: z.string().min(1),
  CEREBRAS_API_KEY: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  TRUST_PROXY: z
    .enum(["1", "0", ""])
    .optional()
    .transform((v) => v === "1"),
  MOCK_REVIEW: z
    .string()
    .optional()
    .transform((v) => v === "1"),
  MOCK_ERROR: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .enum([
        "api-retryable",
        "retry-exhausted",
        "api-400",
        "load-key",
        "unknown",
        "tool-outcomes",
      ])
      .optional()
  ),
});

const parsed = EnvSchema.safeParse(process.env);

export const env = (parsed.success ? parsed.data : {}) as z.infer<
  typeof EnvSchema
>;

export function assertEnv(): void {
  if (!parsed.success) {
    const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${bad}`);
  }
}
