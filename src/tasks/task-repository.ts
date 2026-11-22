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
}

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string;
  readonly priority?: TaskPriority;
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
    const id = randomUUID();
    const now = new Date().toISOString();

    const insertTask = this.database.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, created_at, updated_at
      ) VALUES (?, ?, ?, 'open', ?, ?, ?)
    `);

    const insertAudit = this.database.prepare(`
      INSERT INTO audit_events (
        id, event_type, entity_type, entity_id, payload_json, created_at
      ) VALUES (?, 'task.created', 'task', ?, ?, ?)
    `);

    const create = this.database.transaction(() => {
      insertTask.run(id, title, description, priority, now, now);
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

  list(): Task[] {
    const rows = this.database
      .prepare("SELECT * FROM tasks ORDER BY created_at DESC, id DESC")
      .all() as TaskRow[];

    return rows.map(mapTask);
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
