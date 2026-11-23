import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase, openDatabaseReadOnly } from "../src/db/database.js";
import { runDoctor } from "../src/doctor/doctor.js";

test("doctor checks local storage and reports an unconfigured AI model without failing core health", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-doctor-test-"));
  const config = loadConfig(home);
  const database = openDatabase(config);
  try {
    const report = await runDoctor(config, database, {}, undefined, async () => {
      throw new Error("No local server is running in this test.");
    });
    assert.equal(report.healthy, true);
    assert.equal(report.homeDir, home);
    assert.ok(report.checks.filter((check) => check.name !== "local_ai").every((check) => check.status === "ok"));
    assert.equal(report.checks.find((check) => check.name === "local_ai")?.status, "not_configured");
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("doctor opens an existing database read-only and does not create missing storage", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-doctor-readonly-test-"));
  const config = loadConfig(home);
  try {
    const missing = await runDoctor(config, undefined, {});
    assert.equal(missing.healthy, false);
    assert.equal(missing.checks.find((check) => check.name === "database")?.status, "error");
    assert.equal(existsSync(config.dataDir), false);
    assert.equal(existsSync(config.workspaceDir), false);
    const writable = openDatabase(config);
    writable.close();
    const readonly = openDatabaseReadOnly(config);
    assert.equal((readonly.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
    readonly.close();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
