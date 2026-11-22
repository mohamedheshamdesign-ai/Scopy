import { randomUUID } from "node:crypto";
import type { ScopyDatabase } from "../db/database.js";

export type TaskStatus = "open" | "in_progress" | "completed" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly projectId: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  project_id: string | null;
}

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string;
  readonly priority?: TaskPriority;
  readonly projectId?: string | null;
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task not found: ${id}`);
    this.name = "TaskNotFoundError";
  }
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    projectId: row.project_id,
  };
}

export class TaskRepository {
  constructor(private readonly database: ScopyDatabase) {}

  create(input: CreateTaskInput): Task {
    const title = input.title.trim();
    if (title.length === 0 || title.length > 200) {
      throw new Error("Task title must contain between 1 and 200 characters.");
    }

    const description = input.description?.trim() ?? "";
    const priority = input.priority ?? "normal";
    const projectId = input.projectId?.trim() || null;
    if (projectId) {
      const project = this.database.prepare("SELECT status FROM projects WHERE id = ?").get(projectId) as { status: string } | undefined;
      if (!project || project.status !== "active") throw new Error("Task project was not found or is archived.");
    }
    const id = randomUUID();
    const now = new Date().toISOString();

    const insertTask = this.database.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, created_at, updated_at, project_id
      ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?)
    `);

    const insertAudit = this.database.prepare(`
      INSERT INTO audit_events (
        id, event_type, entity_type, entity_id, payload_json, created_at
      ) VALUES (?, 'task.created', 'task', ?, ?, ?)
    `);

    const create = this.database.transaction(() => {
      insertTask.run(id, title, description, priority, now, now, projectId);
      insertAudit.run(randomUUID(), id, JSON.stringify({ title, priority }), now);
    });

    create();
    return this.getById(id)!;
  }

  getById(id: string): Task | null {
    const row = this.database
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as TaskRow | undefined;

    return row ? mapTask(row) : null;
  }

  list(options: { readonly projectId?: string | null; readonly status?: TaskStatus; readonly limit?: number } = {}): Task[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (options.projectId !== undefined) {
      clauses.push(options.projectId === null ? "project_id IS NULL" : "project_id = ?");
      if (options.projectId !== null) params.push(options.projectId);
    }
    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }
    const limit = options.limit ?? 500;
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new Error("Task list limit must be between 1 and 2000.");
    params.push(limit);
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    const rows = this.database.prepare(
      `SELECT * FROM tasks ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(...params) as TaskRow[];
    return rows.map(mapTask);
  }

  update(id: string, input: {
    readonly title?: string;
    readonly description?: string;
    readonly status?: TaskStatus;
    readonly priority?: TaskPriority;
    readonly projectId?: string | null;
  }): Task {
    const existing = this.getById(id);
    if (!existing) throw new TaskNotFoundError(id);
    const title = input.title === undefined ? existing.title : input.title.trim();
    const description = input.description === undefined ? existing.description : input.description.trim();
    const status = input.status ?? existing.status;
    const priority = input.priority ?? existing.priority;
    const projectId = input.projectId === undefined ? existing.projectId : (input.projectId?.trim() || null);
    if (!title || title.length > 200) throw new Error("Task title must contain between 1 and 200 characters.");
    if (description.length > 4000) throw new Error("Task description cannot exceed 4000 characters.");
    if (input.projectId !== undefined && projectId) {
      const project = this.database.prepare("SELECT status FROM projects WHERE id = ?").get(projectId) as { status: string } | undefined;
      if (!project || project.status !== "active") throw new Error("Task project was not found or is archived.");
    }
    const now = new Date().toISOString();
    const completedAt = status === "completed"
      ? existing.completedAt ?? now
      : input.status === undefined ? existing.completedAt : null;
    const save = this.database.transaction(() => {
      this.database.prepare(`
        UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?,
          project_id = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(title, description, status, priority, projectId, now, completedAt, id);
      this.database.prepare(`
        INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, 'task.updated', 'task', ?, ?, ?)
      `).run(randomUUID(), id, JSON.stringify({
        changedFields: Object.keys(input), status, priority, projectId,
      }), now);
    });
    save();
    return this.getById(id)!;
  }

  complete(id: string): Task {
    const existing = this.getById(id);
    if (!existing) throw new TaskNotFoundError(id);

    if (existing.status === "completed") return existing;

    const now = new Date().toISOString();
    const updateTask = this.database.prepare(`
      UPDATE tasks
      SET status = 'completed', updated_at = ?, completed_at = ?
      WHERE id = ?
    `);

    const insertAudit = this.database.prepare(`
      INSERT INTO audit_events (
        id, event_type, entity_type, entity_id, payload_json, created_at
      ) VALUES (?, 'task.completed', 'task', ?, '{}', ?)
    `);

    const complete = this.database.transaction(() => {
      updateTask.run(now, now, id);
      insertAudit.run(randomUUID(), id, now);
    });

    complete();
    return this.getById(id)!;
  }
}
