import { z } from "zod";

export const DEFAULT_APP_URL = "http://localhost:3000";

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
  APP_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().default(DEFAULT_APP_URL)
  ),
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

const MOCK_PLACEHOLDERS: Record<string, string> = {
  GITHUB_PAT: "mock",
  CEREBRAS_API_KEY: "mock",
  GROQ_API_KEY: "mock",
  GOOGLE_GENERATIVE_AI_API_KEY: "mock",
  DATABASE_URL: "postgres://mock:mock@localhost:5432/mock",
  REDIS_URL: "redis://localhost:6379",
};

const rawEnv: Record<string, string | undefined> = { ...process.env };

if (rawEnv.MOCK_REVIEW === "1") {
  for (const [key, placeholder] of Object.entries(MOCK_PLACEHOLDERS)) {
    if (!rawEnv[key]) rawEnv[key] = placeholder;
  }
}

const parsed = EnvSchema.safeParse(rawEnv);

export const env = (parsed.success ? parsed.data : {}) as z.infer<
  typeof EnvSchema
>;

export function assertEnv(): void {
  if (!parsed.success) {
    const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${bad}`);
  }
}
