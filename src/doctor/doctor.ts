import { existsSync, statSync } from "node:fs";
import { createLocalAiRouter } from "../ai/create-local-router.js";
import type { ScopyConfig } from "../config.js";
import type { ScopyDatabase } from "../db/database.js";

export type DoctorStatus = "ok" | "warning" | "not_configured" | "error";

export interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorStatus;
  readonly detail: string;
}

export interface DoctorReport {
  readonly healthy: boolean;
  readonly homeDir: string;
  readonly checks: readonly DoctorCheck[];
}

export async function runDoctor(
  config: ScopyConfig,
  database: ScopyDatabase | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  databaseError?: string,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  if (!database) {
    checks.push({ name: "database", status: "error", detail: databaseError ?? "Scopy database could not be opened read-only." });
    checks.push({ name: "schema", status: "error", detail: "Schema check unavailable without an existing database." });
  } else {
    try {
      const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      checks.push({ name: "database", status: integrity.integrity_check === "ok" ? "ok" : "error", detail: integrity.integrity_check });
      const migration = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null };
      checks.push({ name: "schema", status: migration.version === null ? "error" : "ok", detail: "migration " + String(migration.version ?? "missing") });
    } catch (error) {
      checks.push({ name: "database", status: "error", detail: error instanceof Error ? error.name : "Database check failed." });
    }
  }
  for (const [name, path] of [
    ["workspace", config.workspaceDir], ["backups", config.backupsDir],
    ["logs", config.logsDir], ["temp", config.tempDir],
  ] as const) {
    try {
      checks.push({
        name,
        status: existsSync(path) && statSync(path).isDirectory() ? "ok" : "error",
        detail: path,
      });
    } catch {
      checks.push({ name, status: "error", detail: "Directory check failed." });
    }
  }
  if (!database && environment.SCOPY_LOCAL_AI_MODEL?.trim()) {
    checks.push({ name: "local_ai", status: "warning", detail: "Local AI health check skipped because the Scopy database is unavailable." });
  } else if (!environment.SCOPY_LOCAL_AI_MODEL?.trim()) {
    checks.push({ name: "local_ai", status: "not_configured", detail: "Run scripts\\connect-local-ai.ps1 in the current PowerShell session." });
  } else {
    try {
      const router = createLocalAiRouter(database, environment);
      const provider = router.list()[0];
      const health = provider ? await router.health(provider.id) : null;
      checks.push({
        name: "local_ai",
        status: health?.healthy ? "ok" : "warning",
        detail: health?.detail ?? "No local AI provider is registered.",
      });
    } catch (error) {
      checks.push({ name: "local_ai", status: "warning", detail: error instanceof Error ? error.message : "Local AI check failed." });
    }
  }
  return {
    healthy: checks.every((check) => check.status !== "error"),
    homeDir: config.homeDir,
    checks,
  };
}
