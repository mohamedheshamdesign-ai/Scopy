import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BackupService, restoreBackupSnapshot } from "../src/backup/backup-service.js";
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
    const listed = await backups.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.name, created.name);
    assert.ok((listed[0]?.sizeBytes ?? 0) > 0);
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

test("SQLite restore replaces the database from a verified snapshot after the caller closes it", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-restore-test-"));
  const config = loadConfig(home);
  let database: ReturnType<typeof openDatabase> | undefined = openDatabase(config);
  try {
    new TaskRepository(database).create({ title: "Before snapshot" });
    const backups = new BackupService(database, home);
    const snapshot = await backups.create();
    new TaskRepository(database).create({ title: "After snapshot" });
    const safetyBackup = await backups.create();
    const currentVersion = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number };
    database.close();
    database = undefined;
    const restored = await restoreBackupSnapshot(config.databasePath, config.backupsDir, snapshot.name, currentVersion.version);
    assert.equal(restored.migrationVersion, currentVersion.version);
    database = openDatabase(config);
    const tasks = new TaskRepository(database).list();
    assert.deepEqual(tasks.map((task) => task.title), ["Before snapshot"]);
    assert.equal(new BackupService(database, home).verify(safetyBackup.name).taskCount, 2);
  } finally {
    database?.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("SQLite restore rejects a schema mismatch before replacing the current database", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-restore-mismatch-test-"));
  const config = loadConfig(home);
  let database: ReturnType<typeof openDatabase> | undefined = openDatabase(config);
  try {
    new TaskRepository(database).create({ title: "Keep this record" });
    const snapshot = await new BackupService(database, home).create();
    database.close();
    database = undefined;
    await assert.rejects(restoreBackupSnapshot(config.databasePath, config.backupsDir, snapshot.name, 999), /does not match current schema version/);
    database = openDatabase(config);
    assert.deepEqual(new TaskRepository(database).list().map((task) => task.title), ["Keep this record"]);
  } finally {
    database?.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("backup list returns an empty array when no backup directory exists", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-backup-list-empty-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    assert.deepEqual(await new BackupService(database, home).list(), []);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
