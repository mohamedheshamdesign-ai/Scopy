import type { ScopyDatabase } from "../db/database.js";
import { LocalOpenAIProvider } from "./local-openai-provider.js";
import { ProviderRouter } from "./provider-router.js";

export function createLocalAiRouter(
  database: ScopyDatabase,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ProviderRouter {
  const baseUrl = environment.SCOPY_LOCAL_AI_URL ?? "http://127.0.0.1:8080/v1";
  const model = environment.SCOPY_LOCAL_AI_MODEL;
  if (!model?.trim()) {
    throw new Error("Set SCOPY_LOCAL_AI_MODEL to the exact model ID exposed by your local model server.");
  }

  const rawContextTokens = environment.SCOPY_LOCAL_AI_CONTEXT_TOKENS;
  const maxContextTokens = rawContextTokens === undefined ? 8_192 : Number(rawContextTokens);
  if (!Number.isInteger(maxContextTokens) || maxContextTokens < 1 || maxContextTokens > 262_144) {
    throw new Error("SCOPY_LOCAL_AI_CONTEXT_TOKENS must be an integer between 1 and 262144.");
  }

  // Local models can take several minutes to process long prompts and generate
  // complete answers. Keep health/model-list requests on their shorter limits.
  const rawTimeoutMs = environment.SCOPY_LOCAL_AI_TIMEOUT_MS;
  const timeoutMs = rawTimeoutMs === undefined ? 600_000 : Number(rawTimeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    throw new Error("SCOPY_LOCAL_AI_TIMEOUT_MS must be an integer between 1 and 600000.");
  }

  const router = new ProviderRouter(database);
  router.register(new LocalOpenAIProvider({
    baseUrl,
    model,
    maxContextTokens,
    timeoutMs,
    ...(environment.SCOPY_LOCAL_AI_API_KEY
      ? { apiKey: environment.SCOPY_LOCAL_AI_API_KEY }
      : {}),
  }));
  return router;
}
