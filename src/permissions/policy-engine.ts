import { PermissionRepository } from "./permission-repository.js";
import type { ActionRequest, PolicyDecision } from "./types.js";

export class PolicyEngine {
  constructor(private readonly rules: PermissionRepository) {}

  evaluate(request: ActionRequest): PolicyDecision {
    validateActionRequest(request);
    const rule = this.rules.findMatching(
      request.actorId, request.tool, request.action, request.target,
    );

    if (!rule) {
      return { effect: "deny", reason: "No matching permission rule; default deny.", ruleId: null };
    }

    return {
      effect: rule.effect,
      reason: `Matched permission rule ${rule.id} (${rule.effect}).`,
      ruleId: rule.id,
    };
  }
}

export function validateActionRequest(request: ActionRequest): void {
  for (const [field, value] of Object.entries({
    actorId: request.actorId,
    tool: request.tool,
    action: request.action,
    target: request.target,
  })) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Action request ${field} must be a non-empty string.`);
    }
  }
}
