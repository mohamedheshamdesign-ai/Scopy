import { readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { listLocalModels } from "./local-openai-provider.js";

/**
 * Shared resolution for the local (loopback) model connection.
 *
 * The start-local-ai.ps1 launcher stores the local API key in an ACL-restricted
 * file under <SCOPY_HOME>/secrets and never persists it to the user environment.
 * Resolving it from that file here lets the CLI and the dashboard connect from
 * any shell, not only one where connect-local-ai.ps1 was dot-sourced. The key
 * is read into memory only and is never logged or written elsewhere.
 */

export type LocalAiEnvironment = Readonly<Record<string, string | undefined>>;

export const LOCAL_AI_DEFAULT_BASE_URL = "http://127.0.0.1:8080/v1";
export const LOCAL_AI_API_KEY_RELATIVE_PATH = join("secrets", "local-ai-api-keys.txt");

export function resolveLocalAiBaseUrl(environment: LocalAiEnvironment): string {
  return environment.SCOPY_LOCAL_AI_URL ?? LOCAL_AI_DEFAULT_BASE_URL;
}

/**
 * Reads the launcher-created key file, refusing any path that escapes the Scopy
 * home directory (including through a symlink). Returns undefined when the file
 * is missing, unreadable, empty, or outside the home directory.
 */
function readLocalAiKeyFile(home: string): string | undefined {
  try {
    const realHome = realpathSync(resolve(home));
    const keyPath = join(realHome, LOCAL_AI_API_KEY_RELATIVE_PATH);
    const realKeyPath = realpathSync(keyPath);
    if (!realKeyPath.startsWith(realHome + sep)) {
      return undefined;
    }
    const contents = readFileSync(realKeyPath, "utf8").trim();
    return contents.length > 0 ? contents : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns the local API key from the environment when set, otherwise from the
 * launcher-created key file under the Scopy home directory. Returns undefined
 * when no key is available; callers then connect without credentials and the
 * server's own auth response (for example HTTP 401) surfaces as before.
 */
export function resolveLocalAiApiKey(environment: LocalAiEnvironment): string | undefined {
  const fromEnvironment = environment.SCOPY_LOCAL_AI_API_KEY?.trim();
  if (fromEnvironment) return fromEnvironment;
  const home = environment.SCOPY_HOME?.trim() || process.cwd();
  return readLocalAiKeyFile(home);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves the exact served model ID: the environment value when set, otherwise
 * by asking the loopback server (listLocalModels enforces loopback-only HTTP).
 * Auto-discovery connects only when exactly one model is served; zero or
 * several models require an explicit choice so the app never guesses.
 */
export async function resolveLocalAiModel(
  environment: LocalAiEnvironment,
  listModels: (baseUrl: string, apiKey?: string) => Promise<string[]> = listLocalModels,
): Promise<string> {
  const fromEnvironment = environment.SCOPY_LOCAL_AI_MODEL?.trim();
  if (fromEnvironment) return fromEnvironment;

  const baseUrl = resolveLocalAiBaseUrl(environment);
  const apiKey = resolveLocalAiApiKey(environment);
  let models: string[];
  try {
    models = await listModels(baseUrl, apiKey);
  } catch (error) {
    throw new Error(
      "SCOPY_LOCAL_AI_MODEL is not set and the local model server could not be queried. "
      + "Start it with scripts\\start-local-ai.ps1 first. Detail: " + errorMessage(error),
    );
  }
  const only = models[0];
  if (models.length === 1 && only !== undefined) return only;
  if (models.length === 0) {
    throw new Error("The local model server is running but did not return any model IDs.");
  }
  throw new Error(
    "More than one local model is served. Set SCOPY_LOCAL_AI_MODEL to one of: " + models.join(", "),
  );
}
