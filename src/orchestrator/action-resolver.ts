import type { ActionRequest } from "../permissions/types.js";
import { validatePlanAction, type PlanAction } from "./plan.js";

export function resolvePlanAction(action: PlanAction, actorId: string): ActionRequest {
  const validated = validatePlanAction(action, "resolved");
  const actor = actorId.trim();
  if (!actor) throw new Error("A plan action requires a trusted run actor.");
  if (validated.action !== "write") {
    return { actorId: actor, tool: "filesystem", action: validated.action, target: validated.target, payload: {} };
  }
  return {
    actorId: actor, tool: "filesystem", action: "write", target: validated.target,
    payload: { content: validated.payload.content },
  };
}
