import type { ScopyDatabase } from "../db/database.js";

export interface AuditEvent {
  readonly id: string;
  readonly eventType: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

interface AuditRow {
  id: string; event_type: string; entity_type: string; entity_id: string;
  payload_json: string; created_at: string;
}

function mapEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id, eventType: row.event_type, entityType: row.entity_type,
    entityId: row.entity_id, payload: JSON.parse(row.payload_json) as unknown,
    createdAt: row.created_at,
  };
}

export class AuditRepository {
  constructor(private readonly database: ScopyDatabase) {}

  list(options: { readonly entityType?: string; readonly entityId?: string; readonly limit?: number } = {}): AuditEvent[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (options.entityType) {
      if (options.entityType.length > 100) throw new Error("Audit entity type cannot exceed 100 characters.");
      clauses.push("entity_type = ?");
      params.push(options.entityType);
    }
    if (options.entityId) {
      if (options.entityId.length > 200) throw new Error("Audit entity ID cannot exceed 200 characters.");
      clauses.push("entity_id = ?");
      params.push(options.entityId);
    }
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Audit list limit must be between 1 and 500.");
    params.push(limit);
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    const rows = this.database.prepare(
      "SELECT * FROM audit_events " + where + " ORDER BY created_at DESC, id DESC LIMIT ?",
    ).all(...params) as AuditRow[];
    return rows.map(mapEvent);
  }
}
