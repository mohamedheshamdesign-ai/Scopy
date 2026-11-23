import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LOCAL_AI_API_KEY_RELATIVE_PATH,
  resolveLocalAiApiKey,
  resolveLocalAiBaseUrl,
  resolveLocalAiModel,
} from "../src/ai/local-connection.js";

async function withKeyFile(home: string, contents: string): Promise<string> {
  const keyPath = join(home, LOCAL_AI_API_KEY_RELATIVE_PATH);
  await mkdir(join(home, "secrets"), { recursive: true });
  await writeFile(keyPath, contents, "utf8");
  return keyPath;
}

test("environment API key wins over the key file", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-local-connection-env-"));
  try {
    await withKeyFile(home, "file-key\n");
    assert.equal(
      resolveLocalAiApiKey({ SCOPY_HOME: home, SCOPY_LOCAL_AI_API_KEY: " env-key " }),
      "env-key",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("API key falls back to the launcher key file inside the Scopy home", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-local-connection-file-"));
  try {
    await withKeyFile(home, "launcher-written-key");
    assert.equal(resolveLocalAiApiKey({ SCOPY_HOME: home }), "launcher-written-key");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("missing, empty, or outside-home key files yield no key", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-local-connection-missing-"));
  const outside = await mkdtemp(join(tmpdir(), "scopy-local-connection-outside-"));
  try {
    assert.equal(resolveLocalAiApiKey({ SCOPY_HOME: home }), undefined);

    await withKeyFile(home, "   \n");
    assert.equal(resolveLocalAiApiKey({ SCOPY_HOME: home }), undefined);

    const outsideKey = join(outside, "key.txt");
    await writeFile(outsideKey, "outside-key", "utf8");
    await rm(join(home, LOCAL_AI_API_KEY_RELATIVE_PATH));
    await symlink(outsideKey, join(home, LOCAL_AI_API_KEY_RELATIVE_PATH));
    assert.equal(
      resolveLocalAiApiKey({ SCOPY_HOME: home }),
      undefined,
      "a symlink escaping the Scopy home must not be read",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("base URL defaults to the loopback llama.cpp endpoint", () => {
  assert.equal(resolveLocalAiBaseUrl({}), "http://127.0.0.1:8080/v1");
  assert.equal(resolveLocalAiBaseUrl({ SCOPY_LOCAL_AI_URL: "http://127.0.0.1:9090/v1" }), "http://127.0.0.1:9090/v1");
});

test("model resolution prefers the environment and never queries the server", async () => {
  let queried = false;
  const model = await resolveLocalAiModel({ SCOPY_LOCAL_AI_MODEL: "qwen-local" }, async () => {
    queried = true;
    return [];
  });
  assert.equal(model, "qwen-local");
  assert.equal(queried, false);
});

test("model auto-discovery connects when exactly one model is served", async () => {
  const seen: Array<{ baseUrl: string; apiKey: string | undefined }> = [];
  const model = await resolveLocalAiModel({}, async (baseUrl, apiKey) => {
    seen.push({ baseUrl, apiKey });
    return ["qwen3-coder-30b"];
  });
  assert.equal(model, "qwen3-coder-30b");
  assert.deepEqual(seen, [{ baseUrl: "http://127.0.0.1:8080/v1", apiKey: undefined }]);
});

test("model auto-discovery passes the key-file credential to the server query", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-local-connection-discovery-"));
  try {
    await withKeyFile(home, "discovered-key");
    const seen: Array<string | undefined> = [];
    const model = await resolveLocalAiModel({ SCOPY_HOME: home }, async (_baseUrl, apiKey) => {
      seen.push(apiKey);
      return ["qwen3-coder-30b"];
    });
    assert.equal(model, "qwen3-coder-30b");
    assert.deepEqual(seen, ["discovered-key"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("model auto-discovery refuses to guess between several models", async () => {
  await assert.rejects(
    resolveLocalAiModel({}, async () => ["model-a", "model-b"]),
    /Set SCOPY_LOCAL_AI_MODEL to one of: model-a, model-b/,
  );
});

test("model auto-discovery reports a server with no models and an unreachable server", async () => {
  await assert.rejects(
    resolveLocalAiModel({}, async () => []),
    /did not return any model IDs/,
  );
  await assert.rejects(
    resolveLocalAiModel({}, async () => {
      throw new Error("Local model server returned HTTP 401 while listing models.");
    }),
    /could not be queried/,
  );
});

test("model auto-discovery rejects non-loopback base URLs via the default query", async () => {
  await assert.rejects(
    resolveLocalAiModel({ SCOPY_LOCAL_AI_URL: "https://example.invalid/v1" }),
    /could not be queried.*loopback|loopback.*could not be queried/s,
  );
});

test("router health sends the key-file credential when the environment has none", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-local-connection-router-"));
  const { loadConfig } = await import("../src/config.js");
  const { openDatabase } = await import("../src/db/database.js");
  const { createLocalAiRouter } = await import("../src/ai/create-local-router.js");
  const database = openDatabase(loadConfig(home));
  const originalFetch = globalThis.fetch;
  let authorization: string | null = null;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    authorization = headers.get("authorization");
    return new Response(JSON.stringify({ data: [{ id: "qwen-local" }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await withKeyFile(home, "router-file-key");
    const router = createLocalAiRouter(database, {
      SCOPY_HOME: home,
      SCOPY_LOCAL_AI_MODEL: "qwen-local",
    });
    const health = await router.health("local-openai-compatible");
    assert.equal(health.healthy, true);
    assert.equal(authorization, "Bearer router-file-key");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
