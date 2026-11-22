import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentRegistry, buildAgentMessages } from "../src/agents/agent-registry.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { MemoryRepository } from "../src/memory/memory-repository.js";

test("built-in agent registry exposes bounded advisory-only specialists", () => {
  const registry = new AgentRegistry();
  const agents = registry.list();
  assert.ok(agents.some((agent) => agent.id === "brand-designer"));
  assert.ok(agents.some((agent) => agent.id === "research-analyst"));
  assert.ok(agents.every((agent) => agent.executionMode === "advisory_only" && agent.toolCapabilities.length === 0));
  assert.throws(() => registry.get("unknown-agent"), /Unknown agent/);
  assert.throws(() => new AgentRegistry([agents[0]!, agents[0]!]), /Duplicate agent ID/);
});

test("agent messages include role boundaries and relevant memory as untrusted context", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-agent-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const memory = new MemoryRepository(database).create({
      type: "preference", scope: "global",
      content: "Prefer local-first tools and explicit approval before file changes.",
      sourceType: "user_confirmed", confidence: 1,
    });
    const profile = new AgentRegistry().get("brand-designer");
    const messages = buildAgentMessages(profile, "Develop a visual identity direction.", undefined, [memory]);
    assert.ok(messages.some((message) => message.content.includes("AGENT ROLE: Brand Designer")));
    assert.ok(messages.some((message) => message.content.includes("Prefer local-first tools")));
    assert.ok(messages.some((message) => message.content.includes("advisory-only and has no tools")));
    assert.equal(messages[messages.length - 1]?.role, "user");
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
