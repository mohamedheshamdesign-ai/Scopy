export type PlanRisk = "low" | "medium" | "high";
export type PlanStatus = "draft" | "approved" | "rejected";

export type PlanAction =
  | { readonly tool: "filesystem"; readonly action: "read"; readonly target: string }
  | { readonly tool: "filesystem"; readonly action: "write"; readonly target: string; readonly payload: { readonly content: string } };

export interface PlanStepDraft {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly expectedOutput: string;
  readonly risk: PlanRisk;
  readonly dependsOn: readonly string[];
  readonly action?: PlanAction;
}

export interface GeneratedPlanDraft {
  readonly summary: string;
  readonly steps: readonly PlanStepDraft[];
}

export interface OrchestratorPlan extends GeneratedPlanDraft {
  readonly id: string;
  readonly goal: string;
  readonly status: PlanStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new Error(`Plan ${field} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw new Error(`Plan ${field} must contain between 1 and ${max} characters.`);
  }
  return normalized;
}

export function validatePlanAction(value: unknown, stepId: string): PlanAction {
  if (!record(value)) throw new Error(`Plan step ${stepId} action must be an object.`);
  if (value.tool !== "filesystem") throw new Error(`Plan step ${stepId} uses an unsupported tool.`);
  if (value.action !== "read" && value.action !== "write") throw new Error(`Plan step ${stepId} filesystem action must be read or write.`);
  const allowedKeys = value.action === "read" ? ["tool", "action", "target"] : ["tool", "action", "target", "payload"];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) throw new Error(`Plan step ${stepId} action contains unsupported fields.`);
  const target = boundedString(value.target, `step ${stepId} action target`, 240);
  const segments = target.split("/");
  if (target.startsWith("/") || target.includes("\\") || target.includes(":") ||
      target.includes(String.fromCharCode(0)) || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Plan step ${stepId} action target must be a safe workspace-relative path using forward slashes.`);
  }
  if (value.action === "read") return { tool: "filesystem", action: "read", target };
  if (!record(value.payload) || typeof value.payload.content !== "string" ||
      Object.keys(value.payload).some((key) => key !== "content")) {
    throw new Error(`Plan step ${stepId} write action requires only payload.content as a string.`);
  }
  if (value.payload.content.length > 16_384) throw new Error(`Plan step ${stepId} write content cannot exceed 16384 characters.`);
  return { tool: "filesystem", action: "write", target, payload: { content: value.payload.content } };
}

export function validateGeneratedPlan(value: unknown): GeneratedPlanDraft {
  if (!record(value)) throw new Error("Planner response must be a JSON object.");
  const summary = boundedString(value.summary, "summary", 1_200);
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 15) {
    throw new Error("Plan must contain between 1 and 15 steps.");
  }

  const steps: PlanStepDraft[] = value.steps.map((rawStep, index) => {
    if (!record(rawStep)) throw new Error(`Plan step ${index + 1} must be an object.`);
    const id = boundedString(rawStep.id, `step ${index + 1} id`, 40);
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new Error(`Plan step ID is invalid: ${id}`);
    }
    const risk = rawStep.risk;
    if (risk !== "low" && risk !== "medium" && risk !== "high") {
      throw new Error(`Plan step ${id} has an invalid risk value.`);
    }
    if (!Array.isArray(rawStep.dependsOn) || rawStep.dependsOn.length > 15 ||
      !rawStep.dependsOn.every((item) => typeof item === "string")) {
      throw new Error(`Plan step ${id} dependencies must be an array of step IDs.`);
    }
    const dependsOn = rawStep.dependsOn.map((item) => item.trim());
    if (new Set(dependsOn).size !== dependsOn.length) {
      throw new Error(`Plan step ${id} has duplicate dependencies.`);
    }
    const base = {
      id,
      title: boundedString(rawStep.title, `step ${id} title`, 160),
      description: boundedString(rawStep.description, `step ${id} description`, 2_000),
      expectedOutput: boundedString(rawStep.expectedOutput, `step ${id} expectedOutput`, 500),
      risk,
      dependsOn,
    };
    return rawStep.action === undefined ? base : { ...base, action: validatePlanAction(rawStep.action, id) };
  });

  const ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) throw new Error("Plan step IDs must be unique.");
  for (const step of steps) {
    if (step.dependsOn.includes(step.id)) {
      throw new Error(`Plan step ${step.id} cannot depend on itself.`);
    }
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) {
        throw new Error(`Plan step ${step.id} depends on an unknown step: ${dependency}`);
      }
    }
  }

  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Plan dependencies contain a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of steps) visit(step.id);

  return { summary, steps };
}

export function parsePlannerResponse(text: string): GeneratedPlanDraft {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const json = fenced?.[1] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("The local model did not return valid JSON for the plan. No plan was saved.");
  }
  try {
    return validateGeneratedPlan(parsed);
  } catch (error) {
    throw new Error(`The generated plan failed validation: ${error instanceof Error ? error.message : "unknown validation error"} No plan was saved.`);
  }
}
