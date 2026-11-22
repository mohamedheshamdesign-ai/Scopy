import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { runDoctor } from "../src/doctor/doctor.js";

test("doctor checks local storage and reports an unconfigured AI model without failing core health", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-doctor-test-"));
  const config = loadConfig(home);
  const database = openDatabase(config);
  try {
    const report = await runDoctor(config, database, {});
    assert.equal(report.healthy, true);
    assert.equal(report.homeDir, home);
    assert.ok(report.checks.filter((check) => check.name !== "local_ai").every((check) => check.status === "ok"));
    assert.equal(report.checks.find((check) => check.name === "local_ai")?.status, "not_configured");
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
