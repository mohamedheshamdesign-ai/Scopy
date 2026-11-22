import type { ProviderRouter } from "../ai/provider-router.js";
import type { PlanRepository } from "./plan-repository.js";
import { parsePlannerResponse } from "./plan.js";

const PLANNER_SYSTEM_PROMPT = [
  "You are Scopy's planning component. Convert the user's goal into a practical, ordered plan.",
  "Return exactly one JSON object and no markdown or commentary.",
  "The object must have this shape: {",
  '  "summary": "short plan summary",',
  '  "steps": [{',
  '    "id": "step-1",',
  '    "title": "short action title",',
  '    "description": "specific, actionable explanation",',
  '    "expectedOutput": "observable result",',
  '    "risk": "low",',
  '    "dependsOn": []',
  "  }]",
  "}",
  "Use 2 to 8 steps unless the goal genuinely needs fewer. Use unique IDs such as step-1, step-2.",
  "Dependencies must reference existing step IDs. Prefer dependencies on earlier steps.",
  "Risk must be low, medium, or high. Risk is an estimate, not an authorization decision.",
  "Do not claim that any action has been performed. Do not invent access, files, integrations, or facts.",
  "Do not include executable commands, tool calls, credentials, or instructions to bypass approvals.",
  "Break consequential actions into reviewable steps and clearly identify their expected outputs.",
].join("\n");

export async function generateDraftPlan(
  router: ProviderRouter,
  providerId: string,
  repository: PlanRepository,
  goal: string,
): Promise<ReturnType<PlanRepository["create"]>> {
  const normalizedGoal = goal.trim();
  if (normalizedGoal.length < 1 || normalizedGoal.length > 2_000) {
    throw new Error("Plan goal must contain between 1 and 2000 characters.");
  }
  const response = await router.generate(providerId, {
    messages: [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: normalizedGoal },
    ],
    temperature: 0.1,
    maxOutputTokens: 1_800,
  }, {
    actorId: "user:local",
    purpose: "generate an unapproved orchestrator plan",
  });
  const draft = parsePlannerResponse(response.text);
  return repository.create(normalizedGoal, draft);
}
