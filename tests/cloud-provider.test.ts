import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CloudOpenAIProvider, isPublicCloudAddress } from "../src/ai/cloud-openai-provider.js";
import type { CloudTransport, CloudTransportRequest } from "../src/ai/cloud-openai-provider.js";
import { ProviderRouter } from "../src/ai/provider-router.js";
import { createLocalAiRouter } from "../src/ai/create-local-router.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";

const OPENAI_BASE = "https://api.openai.com/v1";

function cannedTransport(body: unknown): CloudTransport {
  return async () => ({ status: 200, body: JSON.stringify(body) });
}

test("cloud provider refuses non-HTTPS, credentialed, non-443, literal-IP, and unreviewed hosts", () => {
  const base = { model: "cloud-model", apiKey: "test-key" };
  assert.throws(() => new CloudOpenAIProvider({ ...base, baseUrl: "http://api.openai.com/v1" }), /HTTPS on a public host/);
  assert.throws(() => new CloudOpenAIProvider({ ...base, baseUrl: "https://user:pass@api.openai.com/v1" }), /HTTPS on a public host/);
  assert.throws(() => new CloudOpenAIProvider({ ...base, baseUrl: "https://api.openai.com:8443/v1" }), /port 443/);
  assert.throws(() => new CloudOpenAIProvider({ ...base, baseUrl: "https://127.0.0.1:8080/v1" }), /reviewed provider host, not a literal IP/);
  assert.throws(() => new CloudOpenAIProvider({ ...base, baseUrl: "https://93.184.216.34/v1" }), /reviewed provider host, not a literal IP/);
  assert.throws(() => new CloudOpenAIProvider({ ...base, baseUrl: "https://api.example.com/v1" }), /not in the reviewed provider list/);
  // A well-known provider whose protocol this adapter does not implement is still refused:
  // an allowlist entry alone does not create a working integration.
  assert.throws(() => new CloudOpenAIProvider({ ...base, baseUrl: "https://api.anthropic.com/v1" }), /not in the reviewed provider list/);
});

test("cloud provider requires an API key and a model name", () => {
  assert.throws(() => new CloudOpenAIProvider({ baseUrl: OPENAI_BASE, model: "cloud-model", apiKey: "  " }), /API key is required/);
  assert.throws(() => new CloudOpenAIProvider({ baseUrl: OPENAI_BASE, model: " ", apiKey: "test-key" }), /model name is required/);
});

test("cloud generate sends the exact OpenAI Chat Completions protocol offline", async () => {
  const seen: CloudTransportRequest[] = [];
  const transport: CloudTransport = async (request) => {
    seen.push(request);
    return { status: 200, body: JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
  };
  const provider = new CloudOpenAIProvider({ baseUrl: OPENAI_BASE, model: "cloud-model", apiKey: "test-key", transport });
  await provider.generate({ messages: [{ role: "user", content: "hi" }], temperature: 0.2, maxOutputTokens: 16 });
  assert.equal(seen.length, 1);
  const request = seen[0]!;
  assert.equal(request.method, "POST");
  assert.equal(request.path, "/v1/chat/completions");
  assert.equal(request.headers["authorization"], "Bearer test-key");
  assert.equal(request.headers["content-type"], "application/json");
  const body = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
  assert.equal(body.model, "cloud-model");
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 16);
});

test("router registers no cloud provider unless all cloud env vars are set", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-cloud-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const router = createLocalAiRouter(database, { SCOPY_LOCAL_AI_MODEL: "qwen-local" });
    await assert.rejects(
      router.generate("cloud-openai-compatible", { messages: [{ role: "user", content: "hi" }], allowCloudEgress: true }, { actorId: "user:local", purpose: "test" }),
      /Unknown AI provider/,
    );
    assert.throws(
      () => createLocalAiRouter(database, { SCOPY_LOCAL_AI_MODEL: "qwen-local", SCOPY_CLOUD_AI_URL: OPENAI_BASE }),
      /set SCOPY_CLOUD_AI_URL, SCOPY_CLOUD_AI_MODEL, and SCOPY_CLOUD_API_KEY together/,
    );
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("registered cloud provider still requires per-request allowCloudEgress and audits both outcomes", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-cloud-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const router = new ProviderRouter(database);
    router.register(new CloudOpenAIProvider({
      baseUrl: OPENAI_BASE,
      model: "cloud-model",
      apiKey: "test-key",
      transport: cannedTransport({ choices: [{ message: { content: "cloud reply" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
    }));
    const context = { actorId: "user:local", purpose: "cloud test" };
    await assert.rejects(
      router.generate("cloud-openai-compatible", { messages: [{ role: "user", content: "hi" }] }, context),
      /allowCloudEgress/,
    );
    const result = await router.generate("cloud-openai-compatible", { messages: [{ role: "user", content: "hi" }], allowCloudEgress: true }, context);
    assert.equal(result.text, "cloud reply");
    const blocked = database.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'ai.egress.blocked'").get() as { n: number };
    const authorized = database.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'ai.egress.authorized'").get() as { n: number };
    assert.equal(blocked.n, 1, "the blocked egress attempt must be audited");
    assert.equal(authorized.n, 1, "the authorized egress must be audited");
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("cloud transport refuses when DNS yields no reviewed public IPv4 address", async () => {
  const provider = new CloudOpenAIProvider({
    baseUrl: OPENAI_BASE,
    model: "cloud-model",
    apiKey: "test-key",
    lookupFn: async () => [{ address: "169.254.169.254" }],
  });
  await assert.rejects(
    provider.generate({ messages: [{ role: "user", content: "hi" }] }),
    /reviewed public IPv4/,
  );
});

test("cloud transport pins the connection to the validated address (no DNS rebinding)", async () => {
  let lookupCalls = 0;
  // The validated lookup runs inside the connection's own lookup callback; the
  // TLS connection can only dial an address this validation returned. A
  // hostname that first resolves public and later private still cannot move
  // the connection, because there is no second, unvalidated resolution.
  const provider = new CloudOpenAIProvider({
    baseUrl: OPENAI_BASE,
    model: "cloud-model",
    apiKey: "test-key",
    lookupFn: async () => {
      lookupCalls += 1;
      return [{ address: "192.0.2.1" }];
    },
  });
  await assert.rejects(provider.generate({ messages: [{ role: "user", content: "hi" }] }));
  assert.equal(lookupCalls, 1, "exactly one resolution happens, inside the connection path");
});

test("isPublicCloudAddress rejects private, loopback, link-local, mapped, and metadata ranges", () => {
  const blocked = [
    "169.254.169.254", "127.0.0.1", "10.0.0.8", "192.168.1.10", "172.16.0.1",
    "100.64.0.1", "0.0.0.0", "198.18.0.1",
    "::1", "::", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", "::ffff:93.184.216.34", "64:ff9b::808:808",
  ];
  for (const address of blocked) {
    assert.equal(isPublicCloudAddress(address), false, `${address} must be rejected`);
  }
  assert.equal(isPublicCloudAddress("93.184.216.34"), true);
  assert.equal(isPublicCloudAddress("2606:4700:4700::1111"), true);
});

test("cloud health check is egress-gated and audited like generate", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-cloud-test-"));
  const database = openDatabase(loadConfig(home));
  let transportCalls = 0;
  const transport: CloudTransport = async () => {
    transportCalls += 1;
    return { status: 200, body: JSON.stringify({ data: [{ id: "cloud-model" }] }) };
  };
  try {
    const router = new ProviderRouter(database);
    router.register(new CloudOpenAIProvider({
      baseUrl: OPENAI_BASE,
      model: "cloud-model",
      apiKey: "test-key",
      transport,
    }));
    const blocked = await router.health("cloud-openai-compatible");
    assert.equal(blocked.healthy, false);
    assert.match(blocked.detail, /allowCloudEgress/);
    assert.equal(transportCalls, 0, "no egress may happen without the opt-in");
    const allowed = await router.health("cloud-openai-compatible", undefined, { allowCloudEgress: true });
    assert.equal(allowed.healthy, true);
    assert.equal(transportCalls, 1);
    const blockedAudits = database.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'ai.egress.blocked'").get() as { n: number };
    const authorizedAudits = database.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'ai.egress.authorized'").get() as { n: number };
    assert.equal(blockedAudits.n, 1);
    assert.equal(authorizedAudits.n, 1);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
