import { z } from "zod";

const EnvSchema = z.object({
  GITHUB_PAT: z.string().min(1),
  CEREBRAS_API_KEY: z.string().min(1),
  GROQ_API_KEY: z.string().min(1).optional(),
  // ВРЕМЕННО (прогон темы 5): Sonnet 4.6 через AITunnel. Убрать при откате на groq.
  AI_TUNNEL_API_KEY: z.string().min(1),
  // GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  // Dev-флаг: "1" → /api/review стримит фикстурный мок вместо LLM
  // (lib/ai/mock/stream-text-mock.ts). Отсутствие/другое значение → прод-поведение.
  MOCK_REVIEW: z
    .string()
    .optional()
    .transform((v) => v === "1"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(
    `Invalid or missing environment variables: ${bad}. Check .env.local`,
  );
}

export const env = parsed.data;
