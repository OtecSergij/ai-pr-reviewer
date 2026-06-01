import { z } from "zod";

const EnvSchema = z.object({
  GITHUB_PAT: z.string().min(1),
  // CEREBRAS_API_KEY: z.string().min(1),
  GROQ_API_KEY: z.string().min(1).optional(),
  // GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(
    `Invalid or missing environment variables: ${bad}. Check .env.local`,
  );
}

export const env = parsed.data;
