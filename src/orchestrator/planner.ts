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
  '    "dependsOn": [],',
  "  }]",
  "}",
  "Use the smallest useful sequence, normally 1 to 6 steps. Simple file tasks should use one action step, plus a verification step only when useful. Do not invent navigation, changing-directory, or other ceremonial steps. Use unique IDs such as step-1, step-2.",
  "The action field is optional. When included, its exact write shape is { \"tool\": \"filesystem\", \"action\": \"write\", \"target\": \"relative/path.txt\", \"payload\": { \"content\": \"text\" } }. For reads, use action=read and omit payload. Never include an action for unsupported or manual work.",
  "Dependencies must reference existing step IDs. Prefer dependencies on earlier steps.",
  "Risk must be low, medium, or high. Risk is an estimate, not an authorization decision.",
  "Do not claim that any action has been performed. Do not invent access, files, integrations, or facts.",
  "For supported filesystem work, include a typed action object using only tool=filesystem and action=read or write. The action field is optional for manual/research steps. Target must be workspace-relative, use forward slashes, and contain no absolute path, drive letter, backslash, or dot segment (except `.` for listing the workspace root). A write action requires payload.content as plain text (maximum 16384 characters); a read action omits payload. For unsupported work, omit action.",
  "Never include shell commands, terminal commands, arbitrary tool names, credentials, or approval bypasses. Plan approval is not tool authorization; policy and exact action approval still apply.",
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
