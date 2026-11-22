import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalAiRouter } from "../src/ai/create-local-router.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";

test("local AI router passes the configured generation timeout to its provider", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-local-router-timeout-"));
  const database = openDatabase(loadConfig(home));
  const originalFetch = globalThis.fetch;
  let requestSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestSignal = init?.signal as AbortSignal | undefined;
    return await new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(requestSignal?.reason ?? new Error("Request aborted."));
      if (requestSignal?.aborted) abort();
      else requestSignal?.addEventListener("abort", abort, { once: true });
    });
  }) as typeof fetch;

  try {
    const router = createLocalAiRouter(database, {
      SCOPY_LOCAL_AI_MODEL: "qwen-local",
      SCOPY_LOCAL_AI_TIMEOUT_MS: "25",
    });

    await assert.rejects(
      router.generate("local-openai-compatible", {
        messages: [{ role: "user", content: "Test timeout configuration." }],
      }, { actorId: "user:local", purpose: "timeout test" }),
      (error: unknown) => error === requestSignal?.reason,
    );
    assert.ok(requestSignal, "provider should pass an AbortSignal to fetch");
    assert.ok(requestSignal.aborted, "configured timeout should abort the request");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("local AI router rejects invalid generation timeout configuration", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-local-router-invalid-timeout-"));
  const database = openDatabase(loadConfig(home));
  try {
    assert.throws(
      () => createLocalAiRouter(database, {
        SCOPY_LOCAL_AI_MODEL: "qwen-local",
        SCOPY_LOCAL_AI_TIMEOUT_MS: "600001",
      }),
      /SCOPY_LOCAL_AI_TIMEOUT_MS must be an integer between 1 and 600000/,
    );
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
