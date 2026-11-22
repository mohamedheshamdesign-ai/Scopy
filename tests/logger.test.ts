import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ScopyLogger } from "../src/logging/scopy-logger.js";

test("structured logger redacts secrets and rotates bounded local logs", () => {
  const home = mkdtempSync(join(tmpdir(), "scopy-logger-test-"));
  const logs = join(home, "logs");
  try {
    const logger = new ScopyLogger(logs, 300);
    logger.info("test.redaction", {
      apiKey: "local-secret-value",
      content: "private file content",
      authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
      note: "request used Bearer abcdefghijklmnopqrstuvwxyz",
    });
    const first = readFileSync(join(logs, "scopy.log"), "utf8");
    assert.ok(first.includes('"level":"info"'));
    assert.ok(first.includes('"apiKey":"[REDACTED]"'));
    assert.ok(first.includes('"content":"[REDACTED]"'));
    assert.ok(!first.includes("local-secret-value"));
    assert.ok(!first.includes("abcdefghijklmnopqrstuvwxyz"));
    logger.warn("test.rotation", { detail: "x".repeat(1_000) });
    assert.equal(existsSync(join(logs, "scopy.log.1")), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
