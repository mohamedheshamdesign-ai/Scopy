import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BackupService } from "../src/backup/backup-service.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { ProjectRepository } from "../src/projects/project-repository.js";
import { TaskRepository } from "../src/tasks/task-repository.js";

test("SQLite backups are consistent, verifiable, and confined to Scopy backup names", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-backup-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const projects = new ProjectRepository(database);
    const tasks = new TaskRepository(database);
    const project = projects.create({ name: "Backup test project" });
    tasks.create({ title: "Included in snapshot", projectId: project.id });
    const backups = new BackupService(database, home);
    const created = await backups.create();
    assert.equal(created.integrity, "ok");
    assert.equal(created.migrationVersion, 8);
    assert.equal(created.taskCount, 1);
    assert.equal(created.projectCount, 1);
    tasks.create({ title: "Created after snapshot" });
    const verified = backups.verify(created.name);
    assert.equal(verified.taskCount, 1);
    assert.equal(verified.projectCount, 1);
    assert.throws(() => backups.verify("../outside.sqlite"), /filename created by Scopy/);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
