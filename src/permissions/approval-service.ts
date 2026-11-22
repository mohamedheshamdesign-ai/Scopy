import { createHash, randomUUID } from "node:crypto";
import type { ScopyDatabase } from "../db/database.js";
import { PolicyEngine } from "./policy-engine.js";
import type { ActionRequest, ApprovalRequest, ApprovalStatus } from "./types.js";

interface ApprovalRow {
  id: string;
  actor_id: string;
  tool_name: string;
  action_name: string;
  target: string;
  action_json: string;
  action_hash: string;
  status: ApprovalStatus;
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  consumed_at: string | null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)]);
    return Object.fromEntries(entries);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Action payload numbers must be finite.");
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new Error("Action payload must contain JSON-compatible values.");
  }
  return value;
}

export function serializeAction(request: ActionRequest): string {
  const normalized = {
    actorId: request.actorId,
    tool: request.tool,
    action: request.action,
    target: request.target,
    payload: request.payload ?? {},
  };
  const serialized = JSON.stringify(stableValue(normalized));
  if (serialized === undefined) throw new Error("Action payload could not be serialized.");
  return serialized;
}

export function hashAction(request: ActionRequest): string {
  return createHash("sha256").update(serializeAction(request)).digest("hex");
}

function mapApproval(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    actorId: row.actor_id,
    tool: row.tool_name,
    action: row.action_name,
    target: row.target,
    payload: JSON.parse(row.action_json) as { payload: Record<string, unknown> }.payload,
    actionHash: row.action_hash,
    status: row.status,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    consumedAt: row.consumed_at,
  };
}

export class ApprovalService {
  constructor(
    private readonly database: ScopyDatabase,
    private readonly policy: PolicyEngine,
  ) {}

  request(request: ActionRequest): ApprovalRequest {
    const decision = this.policy.evaluate(request);
    if (decision.effect === "deny") {
      throw new Error("This action is denied by policy and cannot be submitted for approval.");
    }
    if (decision.effect !== "approval_required") {
      throw new Error("This action does not require approval.");
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const actionJson = serializeAction(request);
    const actionHash = hashAction(request);
    const create = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO approval_requests (
          id, actor_id, tool_name, action_name, target, action_json, action_hash,
          status, requested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(id, request.actorId, request.tool, request.action, request.target, actionJson, actionHash, now);
      this.database.prepare(`
        INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, 'approval.requested', 'approval', ?, ?, ?)
      `).run(randomUUID(), id, JSON.stringify({ actorId: request.actorId, tool: request.tool, action: request.action, target: request.target }), now);
    });
    create();
    return this.getById(id)!;
  }

  getById(id: string): ApprovalRequest | null {
    const row = this.database.prepare("SELECT * FROM approval_requests WHERE id = ?")
      .get(id) as ApprovalRow | undefined;
    return row ? mapApproval(row) : null;
  }

  listPending(): ApprovalRequest[] {
    const rows = this.database.prepare(
      "SELECT * FROM approval_requests WHERE status = 'pending' ORDER BY requested_at ASC",
    ).all() as ApprovalRow[];
    return rows.map(mapApproval);
  }

  approve(id: string, reviewerId: string): ApprovalRequest {
    return this.review(id, reviewerId, "approved");
  }

  reject(id: string, reviewerId: string): ApprovalRequest {
    return this.review(id, reviewerId, "rejected");
  }

  private review(id: string, reviewerId: string, status: "approved" | "rejected"): ApprovalRequest {
    if (!reviewerId.trim()) throw new Error("Reviewer ID cannot be empty.");
    const now = new Date().toISOString();
    const review = this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE approval_requests
        SET status = ?, reviewed_at = ?, reviewed_by = ?
        WHERE id = ? AND status = 'pending'
      `).run(status, now, reviewerId.trim(), id);
      if (result.changes !== 1) {
        throw new Error("Approval request is missing or is no longer pending.");
      }
      this.database.prepare(`
        INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, ?, 'approval', ?, ?, ?)
      `).run(randomUUID(), `approval.${status}`, id, JSON.stringify({ reviewerId: reviewerId.trim() }), now);
    });
    review();
    return this.getById(id)!;
  }

  consume(id: string, expectedActionHash: string): boolean {
    const now = new Date().toISOString();
    const consume = this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE approval_requests SET status = 'consumed', consumed_at = ?
        WHERE id = ? AND status = 'approved' AND action_hash = ?
      `).run(now, id, expectedActionHash);
      if (result.changes !== 1) return false;
      this.database.prepare(`
        INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, 'approval.consumed', 'approval', ?, '{}', ?)
      `).run(randomUUID(), id, now);
      return true;
    });
    return consume();
  }
}
