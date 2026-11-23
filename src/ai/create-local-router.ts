import type { ScopyDatabase } from "../db/database.js";
import { CloudOpenAIProvider } from "./cloud-openai-provider.js";
import { resolveLocalAiApiKey, resolveLocalAiModel } from "./local-connection.js";
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

  const apiKey = resolveLocalAiApiKey(environment);
  const router = new ProviderRouter(database);
  router.register(new LocalOpenAIProvider({
    baseUrl,
    model,
    maxContextTokens,
    timeoutMs,
    ...(apiKey ? { apiKey } : {}),
  }));
  const cloudUrl = environment.SCOPY_CLOUD_AI_URL?.trim();
  const cloudModel = environment.SCOPY_CLOUD_AI_MODEL?.trim();
  const cloudKey = environment.SCOPY_CLOUD_API_KEY?.trim();
  const anyCloud = cloudUrl !== undefined && cloudUrl !== "" || cloudModel !== undefined && cloudModel !== "" || cloudKey !== undefined && cloudKey !== "";
  if (anyCloud) {
    if (!cloudUrl || !cloudModel || !cloudKey) {
      throw new Error("Cloud AI is opt-in: set SCOPY_CLOUD_AI_URL, SCOPY_CLOUD_AI_MODEL, and SCOPY_CLOUD_API_KEY together, or unset all three.");
    }
    const rawCloudTimeout = environment.SCOPY_CLOUD_AI_TIMEOUT_MS;
    const cloudTimeoutMs = rawCloudTimeout === undefined ? undefined : Number(rawCloudTimeout);
    if (cloudTimeoutMs !== undefined && (!Number.isInteger(cloudTimeoutMs) || cloudTimeoutMs < 1 || cloudTimeoutMs > 600_000)) {
      throw new Error("SCOPY_CLOUD_AI_TIMEOUT_MS must be an integer between 1 and 600000.");
    }
    router.register(new CloudOpenAIProvider({
      baseUrl: cloudUrl,
      model: cloudModel,
      apiKey: cloudKey,
      ...(cloudTimeoutMs !== undefined ? { timeoutMs: cloudTimeoutMs } : {}),
    }));
  }
  return router;
}

/**
 * Self-connecting variant for interactive entry points (CLI ai commands and the
 * dashboard). On top of createLocalAiRouter it discovers the served model ID
 * from the loopback server when SCOPY_LOCAL_AI_MODEL is not set, so a running
 * local server is enough — no per-shell connect script required. The explicit
 * environment configuration always wins, and createLocalAiRouter remains the
 * strictly env-driven path for tests and scripted use.
 */
export async function connectLocalAiRouter(
  database: ScopyDatabase,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ProviderRouter> {
  const model = await resolveLocalAiModel(environment);
  return createLocalAiRouter(database, { ...environment, SCOPY_LOCAL_AI_MODEL: model });
}
