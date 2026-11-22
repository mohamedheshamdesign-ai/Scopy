import { randomUUID } from "node:crypto";
import type { ScopyDatabase } from "../db/database.js";

export type MemoryType = "working" | "episodic" | "semantic" | "project" | "preference" | "procedural";

export interface MemoryInput {
  readonly type: MemoryType;
  readonly scope?: string;
  readonly content: string;
  readonly sourceType: string;
  readonly sourceRef?: string;
  readonly confidence?: number;
  readonly expiresAt?: string | null;
}

export interface MemoryRecord {
  readonly id: string;
  readonly type: MemoryType;
  readonly scope: string;
  readonly content: string;
  readonly sourceType: string;
  readonly sourceRef: string;
  readonly confidence: number;
  readonly status: "active" | "archived";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string | null;
}

export interface MemorySearchOptions {
  readonly scope?: string;
  readonly type?: MemoryType;
  readonly limit?: number;
}

function mapRow(row: Record<string, unknown>): MemoryRecord {
  return {
    id: row.id as string,
    type: row.memory_type as MemoryType,
    scope: row.scope as string,
    content: row.content as string,
    sourceType: row.source_type as string,
    sourceRef: row.source_ref as string,
    confidence: row.confidence as number,
    status: row.status as "active" | "archived",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    expiresAt: row.expires_at as string | null,
  };
}

function tokens(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);
}

export class MemoryRepository {
  constructor(private readonly database: ScopyDatabase) {}

  create(input: MemoryInput): MemoryRecord {
    const content = input.content.trim();
    const scope = input.scope?.trim() || "global";
    const sourceType = input.sourceType.trim();
    const sourceRef = input.sourceRef?.trim() ?? "";
    const confidence = input.confidence ?? 0.8;
    if (!content || content.length > 20_000) throw new Error("Memory content must contain 1–20000 characters.");
    if (!scope || scope.length > 200) throw new Error("Memory scope must contain 1–200 characters.");
    if (!sourceType || sourceType.length > 100) throw new Error("Memory sourceType must contain 1–100 characters.");
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error("Memory confidence must be between 0 and 1.");
    }
    if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) {
      throw new Error("Memory expiresAt must be a valid date.");
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO memory_records (
        id, memory_type, scope, content, source_type, source_ref,
        confidence, status, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, input.type, scope, content, sourceType, sourceRef, confidence, now, now, input.expiresAt ?? null);
    this.database.prepare(`
      INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, 'memory.created', 'memory_record', ?, ?, ?)
    `).run(randomUUID(), id, JSON.stringify({
      type: input.type, scope, sourceType, sourceRef, confidence,
    }), now);
    return this.getById(id)!;
  }

  getById(id: string): MemoryRecord | undefined {
    const row = this.database.prepare("SELECT * FROM memory_records WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  search(query: string, options: MemorySearchOptions = {}): MemoryRecord[] {
    const queryTokens = tokens(query);
    if (queryTokens.size === 0) return [];
    const limit = options.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Memory search limit must be between 1 and 100.");
    }
    const clauses = ["status = 'active'", "(expires_at IS NULL OR expires_at > ?)"];
    const params: (string | number)[] = [new Date().toISOString()];
    if (options.scope) {
      clauses.push("scope IN (?, 'global')");
      params.push(options.scope);
    }
    if (options.type) {
      clauses.push("memory_type = ?");
      params.push(options.type);
    }
    const rows = this.database.prepare(
      `SELECT * FROM memory_records WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT 500`,
    ).all(...params) as Record<string, unknown>[];

    return rows.map(mapRow).map((record) => {
      const contentTokens = tokens(record.content);
      let matched = 0;
      for (const token of queryTokens) if (contentTokens.has(token)) matched++;
      const phraseBoost = record.content.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ? 0.5 : 0;
      const score = matched / queryTokens.size + phraseBoost;
      return { record, score };
    }).filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.record.confidence - a.record.confidence)
      .slice(0, limit)
      .map((item) => item.record);
  }

  archive(id: string): boolean {
    const now = new Date().toISOString();
    const result = this.database.prepare(
      "UPDATE memory_records SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'active'",
    ).run(now, id);
    if (result.changes === 1) {
      this.database.prepare(`
        INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, 'memory.archived', 'memory_record', ?, '{}', ?)
      `).run(randomUUID(), id, now);
    }
    return result.changes === 1;
  }

  list(options: { readonly scope?: string; readonly type?: MemoryType; readonly limit?: number } = {}): MemoryRecord[] {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Memory list limit must be between 1 and 500.");
    }
    const clauses = ["status = 'active'"];
    const params: (string | number)[] = [];
    if (options.scope) {
      clauses.push("scope = ?");
      params.push(options.scope);
    }
    if (options.type) {
      clauses.push("memory_type = ?");
      params.push(options.type);
    }
    params.push(limit);
    const rows = this.database.prepare(
      `SELECT * FROM memory_records WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`,
    ).all(...params) as Record<string, unknown>[];
    return rows.map(mapRow);
  }
}
