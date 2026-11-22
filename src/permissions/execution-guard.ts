import { randomUUID } from "node:crypto";
import type { ScopyDatabase } from "../db/database.js";
import { ApprovalService, hashAction } from "./approval-service.js";
import { PolicyEngine } from "./policy-engine.js";
import type { ActionRequest } from "./types.js";

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export class ApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalRequiredError";
  }
}

export class ExecutionGuard {
  constructor(
    private readonly database: ScopyDatabase,
    private readonly policy: PolicyEngine,
    private readonly approvals: ApprovalService,
  ) {}

  async execute<T>(
    request: ActionRequest,
    handler: () => T | Promise<T>,
    approvalId?: string,
  ): Promise<T> {
    const decision = this.policy.evaluate(request);
    if (decision.effect === "deny") {
      this.record(request, "tool.execution.denied", { reason: decision.reason });
      throw new PermissionDeniedError(decision.reason);
    }

    if (decision.effect === "approval_required") {
      if (!approvalId) {
        throw new ApprovalRequiredError("Explicit approval is required before this action can execute.");
      }
      if (!this.approvals.consume(approvalId, hashAction(request))) {
        throw new PermissionDeniedError("Approval is invalid, rejected, already used, or does not match this exact action.");
      }
    }

    this.record(request, "tool.execution.started", { ruleId: decision.ruleId });
    try {
      const result = await handler();
      this.record(request, "tool.execution.succeeded", {});
      return result;
    } catch (error) {
      this.record(request, "tool.execution.failed", {
        error: error instanceof Error ? error.message : "Unknown execution error",
      });
      throw error;
    }
  }

  private record(request: ActionRequest, eventType: string, payload: Record<string, unknown>): void {
    this.database.prepare(`
      INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, 'tool_action', ?, ?, ?)
    `).run(
      randomUUID(),
      eventType,
      `${request.tool}:${request.action}:${request.target}`,
      JSON.stringify({ actorId: request.actorId, ...payload }),
      new Date().toISOString(),
    );
  }
}
