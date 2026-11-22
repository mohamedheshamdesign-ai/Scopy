import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { TaskNotFoundError, TaskRepository } from "../src/tasks/task-repository.js";

test("tasks persist across database restarts and create audit events", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "scopy-test-"));
  const config = loadConfig(homeDir);

  try {
    const firstDatabase = openDatabase(config);
    const firstRepository = new TaskRepository(firstDatabase);
    const created = firstRepository.create({
      title: "  Verify Scopy persistence  ",
      description: "First vertical slice",
      priority: "high",
    });

    assert.equal(created.title, "Verify Scopy persistence");
    assert.equal(created.status, "open");
    assert.equal(created.priority, "high");
    firstDatabase.close();

    const secondDatabase = openDatabase(config);
    const secondRepository = new TaskRepository(secondDatabase);
    const restored = secondRepository.getById(created.id);

    assert.ok(restored);
    assert.equal(restored.title, created.title);

    const completed = secondRepository.complete(created.id);
    assert.equal(completed.status, "completed");
    assert.ok(completed.completedAt);

    const auditCount = secondDatabase
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE entity_id = ?")
      .get(created.id) as { count: number };

    assert.equal(auditCount.count, 2);
    secondDatabase.close();
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("rejects empty task titles and reports missing tasks", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "scopy-test-"));
  const config = loadConfig(homeDir);
  const database = openDatabase(config);

  try {
    const repository = new TaskRepository(database);

    assert.throws(() => repository.create({ title: "   " }));
    assert.throws(
      () => repository.complete("missing-task"),
      TaskNotFoundError,
    );
  } finally {
    database.close();
    rmSync(homeDir, { recursive: true, force: true });
  }
});
