import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { MemoryRepository } from "../src/memory/memory-repository.js";

test("memory records preserve provenance, confidence, scope, and type", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-memory-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const memory = new MemoryRepository(database);
    const saved = memory.create({
      type: "preference",
      scope: "project:scopy",
      content: "Prefer local-first AI providers and explicit approval for cloud data transfer.",
      sourceType: "user_confirmed",
      sourceRef: "conversation:setup",
      confidence: 1,
    });
    const loaded = memory.getById(saved.id);
    assert.equal(loaded?.type, "preference");
    assert.equal(loaded?.scope, "project:scopy");
    assert.equal(loaded?.sourceType, "user_confirmed");
    assert.equal(loaded?.sourceRef, "conversation:setup");
    assert.equal(loaded?.confidence, 1);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("memory search ranks lexical matches and includes global plus requested scope", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-memory-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const memory = new MemoryRepository(database);
    const scoped = memory.create({
      type: "project", scope: "project:scopy",
      content: "Scopy uses a local SQLite database and local-first model routing.",
      sourceType: "project_note", confidence: 0.95,
    });
    memory.create({
      type: "semantic", scope: "global",
      content: "A local-first architecture keeps private data on the user's machine.",
      sourceType: "user_confirmed", confidence: 1,
    });
    memory.create({
      type: "project", scope: "project:other",
      content: "Scopy local model routing is not configured in this other project.",
      sourceType: "imported", confidence: 1,
    });

    const results = memory.search("local-first Scopy model routing", {
      scope: "project:scopy",
      limit: 10,
    });
    assert.equal(results.length, 2);
    assert.equal(results[0]?.id, scoped.id);
    assert.ok(results.some((item) => item.scope === "global"));
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("memory search excludes expired and archived records", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-memory-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const memory = new MemoryRepository(database);
    const expired = memory.create({
      type: "working", content: "temporary working context for Scopy",
      sourceType: "runtime", expiresAt: "2000-01-01T00:00:00.000Z",
    });
    const archived = memory.create({
      type: "working", content: "archived working context for Scopy",
      sourceType: "runtime",
    });
    assert.equal(memory.archive(archived.id), true);
    const results = memory.search("working context Scopy");
    assert.equal(results.length, 0);
    assert.equal(memory.getById(expired.id)?.status, "active");
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("memory validates confidence and refuses empty content", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-memory-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const memory = new MemoryRepository(database);
    assert.throws(() => memory.create({
      type: "semantic", content: " ", sourceType: "test",
    }), /Memory content/);
    assert.throws(() => memory.create({
      type: "semantic", content: "valid", sourceType: "test", confidence: 1.5,
    }), /confidence/);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
