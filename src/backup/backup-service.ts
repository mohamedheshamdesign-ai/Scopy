import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
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
