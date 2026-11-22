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

  const router = new ProviderRouter(database);
  router.register(new LocalOpenAIProvider({
    baseUrl,
    model,
    ...(environment.SCOPY_LOCAL_AI_API_KEY
      ? { apiKey: environment.SCOPY_LOCAL_AI_API_KEY }
      : {}),
  }));
  return router;
}
