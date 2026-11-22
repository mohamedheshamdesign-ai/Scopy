import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuditRepository } from "../src/audit/audit-repository.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { TaskRepository } from "../src/tasks/task-repository.js";

test("audit events can be inspected and filtered by entity", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-audit-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const tasks = new TaskRepository(database);
    const task = tasks.create({ title: "Review audit events" });
    tasks.update(task.id, { priority: "high" });
    const audit = new AuditRepository(database);
    const all = audit.list({ limit: 10 });
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((event) => event.eventType).sort(), ["task.created", "task.updated"]);
    const filtered = audit.list({ entityType: "task", entityId: task.id });
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((event) => event.entityId === task.id));
    assert.throws(() => audit.list({ limit: 501 }), /between 1 and 500/);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
