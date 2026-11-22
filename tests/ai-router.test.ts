import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalOpenAIProvider } from "../src/ai/local-openai-provider.js";
import { ProviderRouter } from "../src/ai/provider-router.js";
import type { ModelProvider } from "../src/ai/types.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";

test("local provider refuses non-loopback and non-HTTP endpoints", () => {
  assert.throws(() => new LocalOpenAIProvider({
    baseUrl: "https://api.example.com/v1",
    model: "model",
  }), /localhost or a loopback IP/);
  assert.throws(() => new LocalOpenAIProvider({
    baseUrl: "http://192.168.1.10:8080/v1",
    model: "model",
  }), /localhost or a loopback IP/);
});

test("local provider health and chat use OpenAI-compatible endpoints", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls++;
    const url = String(input);
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "qwen-local" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      model: "qwen-local",
      choices: [{ message: { content: "Hello from Scopy local model." } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const provider = new LocalOpenAIProvider({
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "qwen-local",
    });
    assert.equal((await provider.health()).healthy, true);
    const result = await provider.generate({
      messages: [{ role: "user", content: "Hello" }],
    });
    assert.equal(result.text, "Hello from Scopy local model.");
    assert.equal(result.providerId, "local-openai-compatible");
    assert.equal(result.inputTokens, 12);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider router blocks cloud egress unless explicitly opted in and audits both outcomes", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-ai-test-"));
  const database = openDatabase(loadConfig(home));
  const cloud: ModelProvider = {
    descriptor: {
      id: "test-cloud",
      label: "Test cloud",
      dataBoundary: "cloud",
      models: ["cloud-model"],
      capabilities: { chat: true, streaming: false, tools: false, vision: false, maxContextTokens: 1000 },
    },
    health: async () => ({ healthy: true, checkedAt: new Date().toISOString(), detail: "ok" }),
    generate: async () => ({
      providerId: "test-cloud", model: "cloud-model", text: "cloud result", durationMs: 1,
    }),
  };
  try {
    const router = new ProviderRouter(database);
    router.register(cloud);
    const request = { messages: [{ role: "user" as const, content: "private text" }] };
    await assert.rejects(
      router.generate("test-cloud", request, { actorId: "agent:test", purpose: "test" }),
      /Explicit allowCloudEgress/,
    );
    const allowed = await router.generate(
      "test-cloud",
      { ...request, allowCloudEgress: true },
      { actorId: "agent:test", purpose: "explicit test" },
    );
    assert.equal(allowed.text, "cloud result");
    const events = database.prepare(
      "SELECT event_type FROM audit_events WHERE entity_type = 'ai_provider' ORDER BY rowid",
    ).all() as Array<{ event_type: string }>;
    assert.deepEqual(events.map((event) => event.event_type), [
      "ai.egress.blocked",
      "ai.egress.authorized",
    ]);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
