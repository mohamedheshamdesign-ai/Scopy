import { PermissionRepository } from "./permission-repository.js";
import type { ActionRequest, PolicyDecision } from "./types.js";
import type { ScopySafetyProfile } from "../config.js";

export class PolicyEngine {
  constructor(
    private readonly rules: PermissionRepository,
    private readonly profile: ScopySafetyProfile = "strict",
  ) {}

  evaluate(request: ActionRequest): PolicyDecision {
    validateActionRequest(request);
    const rule = this.rules.findMatching(
      request.actorId, request.tool, request.action, request.target,
    );

    if (request.actorId === "user:local" &&
        ((request.tool === "terminal" && request.action === "run") ||
         (request.tool === "browser" && request.action === "open"))) {
      if (rule?.effect === "deny") {
        return { effect: "deny", reason: "A matching explicit deny rule blocks this action.", ruleId: rule.id };
      }
      return {
        effect: "approval_required",
        reason: request.tool === "terminal"
          ? "Terminal commands always require exact explicit approval."
          : "Opening an external browser page requires exact explicit approval.",
        ruleId: rule?.id ?? null,
      };
    }

    if (!rule) {
      if (this.profile === "workspace_assist" && request.actorId === "user:local" && request.tool === "filesystem") {
        if (request.action === "read" || request.action === "list") {
          return { effect: "allow", reason: "Built-in workspace_assist profile permits workspace reads and listings.", ruleId: null };
        }
        if (request.action === "write" || request.action === "mkdir") {
          return { effect: "approval_required", reason: "Built-in workspace_assist profile requires approval for workspace changes.", ruleId: null };
        }
      }
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
