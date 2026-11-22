import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ScopyConfig } from "../config.js";

export type ScopyDatabase = InstanceType<typeof Database>;

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: (database: ScopyDatabase) => void;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "initial_tasks_and_audit",
    up(database) {
      database.exec(`
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open'
            CHECK(status IN ('open', 'in_progress', 'completed', 'cancelled')),
          priority TEXT NOT NULL DEFAULT 'normal'
            CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        ) STRICT;

        CREATE INDEX idx_tasks_status_created
          ON tasks(status, created_at DESC);

        CREATE TABLE audit_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX idx_audit_entity
          ON audit_events(entity_type, entity_id, created_at);
      `);
    },
  },
];

function applyMigrations(database: ScopyDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const hasMigration = database.prepare(
    "SELECT 1 AS found FROM schema_migrations WHERE version = ?",
  );

  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const migration of migrations) {
    if (hasMigration.get(migration.version)) continue;

    const apply = database.transaction(() => {
      migration.up(database);
      recordMigration.run(migration.version, migration.name, new Date().toISOString());
    });

    apply();
  }
}

export function openDatabase(config: ScopyConfig): ScopyDatabase {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(dirname(config.databasePath), { recursive: true });

  const database = new Database(config.databasePath, {
    timeout: 5_000,
  });

  try {
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = NORMAL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    applyMigrations(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
