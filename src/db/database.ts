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
  {
    version: 2,
    name: "central_permissions_and_approvals",
    up(database) {
      database.exec(`
        CREATE TABLE permission_rules (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          action_name TEXT NOT NULL,
          target_pattern TEXT NOT NULL,
          effect TEXT NOT NULL CHECK(effect IN ('allow', 'deny', 'approval_required')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(actor_id, tool_name, action_name, target_pattern)
        ) STRICT;

        CREATE INDEX idx_permission_rules_lookup
          ON permission_rules(actor_id, tool_name, action_name);

        CREATE TABLE approval_requests (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          action_name TEXT NOT NULL,
          target TEXT NOT NULL,
          action_json TEXT NOT NULL,
          action_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'consumed')),
          requested_at TEXT NOT NULL,
          reviewed_at TEXT,
          reviewed_by TEXT,
          consumed_at TEXT
        ) STRICT;

        CREATE INDEX idx_approval_requests_status
          ON approval_requests(status, requested_at DESC);
      `);
    },
  },
  {
    version: 3,
    name: "runtime_executions_and_checkpoints",
    up(database) {
      database.exec(`
        CREATE TABLE execution_runs (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          action_name TEXT NOT NULL,
          target TEXT NOT NULL,
          request_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed', 'cancelled', 'timed_out')),
          timeout_ms INTEGER NOT NULL,
          max_output_bytes INTEGER NOT NULL,
          output_json TEXT,
          error_text TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          duration_ms INTEGER
        ) STRICT;

        CREATE INDEX idx_execution_runs_status_started
          ON execution_runs(status, started_at DESC);

        CREATE TABLE execution_checkpoints (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          checkpoint_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(run_id, sequence)
        ) STRICT;

        CREATE INDEX idx_execution_checkpoints_run_sequence
          ON execution_checkpoints(run_id, sequence DESC);
      `);
    },
  },
  {
    version: 4,
    name: "memory_records_with_provenance",
    up(database) {
      database.exec(`
        CREATE TABLE memory_records (
          id TEXT PRIMARY KEY,
          memory_type TEXT NOT NULL CHECK(memory_type IN ('working', 'episodic', 'semantic', 'project', 'preference', 'procedural')),
          scope TEXT NOT NULL,
          content TEXT NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 20000),
          source_type TEXT NOT NULL,
          source_ref TEXT NOT NULL DEFAULT '',
          confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT
        ) STRICT;

        CREATE INDEX idx_memory_scope_type_status
          ON memory_records(scope, memory_type, status, updated_at DESC);
        CREATE INDEX idx_memory_expiry
          ON memory_records(expires_at) WHERE expires_at IS NOT NULL;
      `);
    },
  },
  {
    version: 5,
    name: "orchestrator_plans_and_steps",
    up(database) {
      database.exec(`
        CREATE TABLE orchestrator_plans (
          id TEXT PRIMARY KEY,
          goal TEXT NOT NULL CHECK(length(trim(goal)) BETWEEN 1 AND 2000),
          summary TEXT NOT NULL CHECK(length(trim(summary)) BETWEEN 1 AND 1200),
          status TEXT NOT NULL DEFAULT 'draft'
            CHECK(status IN ('draft', 'approved', 'rejected')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          reviewed_at TEXT,
          reviewed_by TEXT
        ) STRICT;

        CREATE INDEX idx_orchestrator_plans_status_created
          ON orchestrator_plans(status, created_at DESC);

        CREATE TABLE orchestrator_plan_steps (
          id TEXT NOT NULL,
          plan_id TEXT NOT NULL REFERENCES orchestrator_plans(id) ON DELETE CASCADE,
          position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 15),
          title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
          description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 2000),
          expected_output TEXT NOT NULL CHECK(length(trim(expected_output)) BETWEEN 1 AND 500),
          risk TEXT NOT NULL CHECK(risk IN ('low', 'medium', 'high')),
          dependencies_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          PRIMARY KEY(plan_id, id),
          UNIQUE(plan_id, position)
        ) STRICT;

        CREATE INDEX idx_orchestrator_plan_steps_order
          ON orchestrator_plan_steps(plan_id, position);
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
