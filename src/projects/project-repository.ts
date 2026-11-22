import { randomUUID } from "node:crypto";
import type { ScopyDatabase } from "../db/database.js";

export type ProjectStatus = "active" | "archived";

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

interface ProjectRow {
  id: string; name: string; description: string; status: ProjectStatus;
  created_at: string; updated_at: string; archived_at: string | null;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id, name: row.name, description: row.description, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at,
  };
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super("Project not found: " + id);
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectRepository {
  constructor(private readonly database: ScopyDatabase) {}

  create(input: { readonly name: string; readonly description?: string }): Project {
    const name = input.name.trim();
    const description = input.description?.trim() ?? "";
    if (!name || name.length > 120) throw new Error("Project name must contain between 1 and 120 characters.");
    if (description.length > 4_000) throw new Error("Project description cannot exceed 4000 characters.");
    const id = randomUUID();
    const now = new Date().toISOString();
    const create = this.database.transaction(() => {
      this.database.prepare("INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run(id, name, description, now, now);
      this.database.prepare("INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at) VALUES (?, 'project.created', 'project', ?, ?, ?)").run(randomUUID(), id, JSON.stringify({ name }), now);
    });
    create();
    return this.getById(id)!;
  }

  getById(id: string): Project | null {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  }

  list(options: { readonly includeArchived?: boolean; readonly limit?: number } = {}): Project[] {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Project list limit must be between 1 and 500.");
    const where = options.includeArchived ? "" : "WHERE status = 'active'";
    const rows = this.database.prepare("SELECT * FROM projects " + where + " ORDER BY updated_at DESC, id DESC LIMIT ?").all(limit) as ProjectRow[];
    return rows.map(mapProject);
  }

  archive(id: string): Project {
    const existing = this.getById(id);
    if (!existing) throw new ProjectNotFoundError(id);
    if (existing.status === "archived") return existing;
    const now = new Date().toISOString();
    const archive = this.database.transaction(() => {
      this.database.prepare("UPDATE projects SET status = 'archived', updated_at = ?, archived_at = ? WHERE id = ? AND status = 'active'").run(now, now, id);
      this.database.prepare("INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at) VALUES (?, 'project.archived', 'project', ?, '{}', ?)").run(randomUUID(), id, now);
    });
    archive();
    return this.getById(id)!;
  }
}
