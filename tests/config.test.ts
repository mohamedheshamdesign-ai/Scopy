import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";

test("Scopy config centralizes all local data directories under its home", () => {
  const home = mkdtempSync(join(tmpdir(), "scopy-config-test-"));
  const config = loadConfig(home);
  try {
    assert.equal(config.homeDir, home);
    assert.equal(config.databasePath, join(home, "data", "scopy.sqlite"));
    assert.equal(config.workspaceDir, join(home, "workspace"));
    assert.equal(config.backupsDir, join(home, "backups"));
    assert.equal(config.logsDir, join(home, "logs"));
    assert.equal(config.tempDir, join(home, "temp"));
    const database = openDatabase(config);
    database.close();
    for (const directory of [config.dataDir, config.workspaceDir, config.backupsDir, config.logsDir, config.tempDir]) {
      assert.equal(existsSync(directory), true);
    }
    assert.throws(() => loadConfig(String.fromCharCode(0)), /null character/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
