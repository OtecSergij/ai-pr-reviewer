import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { env } from "@/lib/env";

// ВРЕМЕННО (прогон темы 5): Sonnet 4.6 через AITunnel-прокси (нативный
// Anthropic endpoint /v1/messages). Откат: import { groq } from "@ai-sdk/groq"
// и model: groq("meta-llama/llama-4-scout-17b-16e-instruct").
// Постоянная конфигурация провайдеров — тема 8.
const anthropic = createAnthropic({
  baseURL: "https://api.aitunnel.ru/v1",
  // AITunnel принимает токен только как `Authorization: Bearer` —
  // authToken шлёт его так; apiKey (x-api-key) они отвергают с 401.
  authToken: env.AI_TUNNEL_API_KEY,
});

// TODO(тема 8): динамический выбор провайдера/модели. Пока единая точка истины
// для вызова модели и для лейбла в шапке UI (meta.model).
export const MODEL = "claude-sonnet-4-6";

export const reviewModel = anthropic(MODEL);
