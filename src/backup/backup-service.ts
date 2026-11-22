import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { copyFile, lstat, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { ScopyDatabase } from "../db/database.js";

export interface BackupVerification {
  readonly name: string;
  readonly path: string;
  readonly integrity: "ok";
  readonly migrationVersion: number;
  readonly taskCount: number;
  readonly projectCount: number;
}

export class BackupService {
  private readonly backupDirectory: string;

  constructor(private readonly database: ScopyDatabase, homeDirectory: string) {
    this.backupDirectory = join(homeDirectory, "backups");
  }

  async create(): Promise<BackupVerification> {
    mkdirSync(this.backupDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const name = "scopy-" + timestamp + "-" + randomUUID().slice(0, 8) + ".sqlite";
    const destination = join(this.backupDirectory, name);
    try {
      await this.database.backup(destination);
      return this.verify(name);
    } catch (error) {
      rmSync(destination, { force: true });
      throw error;
    }
  }

  verify(name: string): BackupVerification {
    if (!/^scopy-\d{8}T\d{6}Z-[0-9a-f]{8}\.sqlite$/.test(name)) {
      throw new Error("Backup name is invalid. Verify a filename created by Scopy inside the backups directory.");
    }
    const path = join(this.backupDirectory, name);
    const backup = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const integrityRow = backup.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      if (integrityRow.integrity_check !== "ok") throw new Error("Backup integrity check failed: " + integrityRow.integrity_check);
      const migrationRow = backup.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null };
      if (migrationRow.version === null) throw new Error("Backup does not contain Scopy schema migrations.");
      const taskRow = backup.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
      const projectRow = backup.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
      return {
        name, path, integrity: "ok", migrationVersion: migrationRow.version,
        taskCount: taskRow.count, projectCount: projectRow.count,
      };
    } finally {
      backup.close();
    }
  }
}

export interface BackupRestoreResult {
  readonly name: string;
  readonly path: string;
  readonly migrationVersion: number;
}

function inspectSnapshot(path: string, expectedMigrationVersion: number): number {
  const snapshot = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = snapshot.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (integrity.integrity_check !== "ok") throw new Error("Restore snapshot integrity check failed: " + integrity.integrity_check);
    const migration = snapshot.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null };
    if (migration.version === null) throw new Error("Restore snapshot does not contain Scopy schema migrations.");
    if (migration.version !== expectedMigrationVersion) {
      throw new Error(`Restore snapshot schema version ${migration.version} does not match current schema version ${expectedMigrationVersion}.`);
    }
    snapshot.prepare("SELECT COUNT(*) AS count FROM tasks").get();
    snapshot.prepare("SELECT COUNT(*) AS count FROM projects").get();
    return migration.version;
  } finally {
    snapshot.close();
  }
}

export async function restoreBackupSnapshot(
  databasePath: string,
  backupDirectory: string,
  name: string,
  expectedMigrationVersion: number,
): Promise<BackupRestoreResult> {
  if (!/^scopy-\d{8}T\d{6}Z-[0-9a-f]{8}\.sqlite$/.test(name)) {
    throw new Error("Backup name is invalid. Restore only a filename created by Scopy inside the backups directory.");
  }
  if (!Number.isInteger(expectedMigrationVersion) || expectedMigrationVersion < 1) {
    throw new Error("Expected database schema version is invalid.");
  }
  const sourcePath = join(backupDirectory, name);
  const sourceInfo = await lstat(sourcePath);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
    throw new Error("Restore source must be a regular Scopy backup file, not a directory or symbolic link.");
  }
  const databaseInfo = await lstat(databasePath);
  if (!databaseInfo.isFile() || databaseInfo.isSymbolicLink()) {
    throw new Error("Current Scopy database must be a regular file before restore.");
  }
  const directory = dirname(databasePath);
  const databaseName = basename(databasePath);
  const stagingPath = join(directory, `.${databaseName}.restore-${randomUUID()}.tmp`);
  const rollbackPath = join(directory, `.${databaseName}.rollback-${randomUUID()}.sqlite`);
  await copyFile(sourcePath, stagingPath);
  try {
    const migrationVersion = inspectSnapshot(stagingPath, expectedMigrationVersion);
    for (const sidecar of [`${databasePath}-wal`, `${databasePath}-shm`]) {
      try {
        await lstat(sidecar);
        throw new Error("SQLite sidecar files remain beside the database. Close every Scopy process and retry the restore.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await rename(databasePath, rollbackPath);
    try {
      await rename(stagingPath, databasePath);
      inspectSnapshot(databasePath, expectedMigrationVersion);
      await rm(rollbackPath, { force: true });
      return { name, path: databasePath, migrationVersion };
    } catch (error) {
      await rm(databasePath, { force: true });
      try {
        await rename(rollbackPath, databasePath);
      } catch (rollbackError) {
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : "unknown rollback error";
        throw new Error(`Restore failed and the original database could not be put back. Preserve the safety backup. Rollback error: ${rollbackMessage}`);
      }
      throw error;
    }
  } finally {
    await rm(stagingPath, { force: true });
  }
}
