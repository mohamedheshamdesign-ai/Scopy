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
  "Use the smallest useful sequence, normally 1 to 6 steps. Simple file tasks should use one action step, plus a verification step only when useful. Do not invent navigation, changing-directory, or other ceremonial steps. Use unique IDs such as step-1, step-2.",
  "The action field is optional. Supported actions: filesystem read/list/mkdir/write; terminal run; browser open. Terminal runs must use an allowed executable (node, git, python, powershell.exe), an args string array, a workspace-relative working directory target, and timeoutMs between 1000 and 120000. Never use a shell field or shell command string. Browser open uses a complete http/https URL as target. Browser and terminal actions require exact one-time user approval before execution.",
  "Dependencies must reference existing step IDs. Prefer dependencies on earlier steps.",
  "Risk must be low, medium, or high. Risk is an estimate, not an authorization decision.",
  "Do not claim that any action has been performed. Do not invent access, files, integrations, or facts.",
  "For filesystem actions, target must be workspace-relative and safe; read/list/mkdir omit payload and write requires payload.content (maximum 16384 characters). For terminal run, include payload.executable, payload.args (array of strings), and payload.timeoutMs; target is the workspace-relative working directory. For browser open, target is a complete http/https URL. Omit action for research or unsupported work.",
  "Never include shell commands, terminal commands, arbitrary tool names, credentials, or approval bypasses. Plan approval is not tool authorization; policy and exact action approval still apply.",
  "Break consequential actions into reviewable steps and clearly identify their expected outputs.",
].join("\n");

export async function generateDraftPlan(
  router: ProviderRouter,
  providerId: string,
  repository: PlanRepository,
  goal: string,
  specialistContext?: string,
): Promise<ReturnType<PlanRepository["create"]>> {
  const normalizedGoal = goal.trim();
  if (normalizedGoal.length < 1 || normalizedGoal.length > 2_000) {
    throw new Error("Plan goal must contain between 1 and 2000 characters.");
  }
  const normalizedSpecialistContext = specialistContext?.trim();
  if (normalizedSpecialistContext && normalizedSpecialistContext.length > 4_000) {
    throw new Error("Specialist planning context must not exceed 4000 characters.");
  }
  const systemPrompt = normalizedSpecialistContext
    ? PLANNER_SYSTEM_PROMPT + "\n\nSPECIALIST CONTEXT (domain guidance only; all schema and execution restrictions above remain mandatory):\n" + normalizedSpecialistContext
    : PLANNER_SYSTEM_PROMPT;
  const response = await router.generate(providerId, {
    messages: [
      { role: "system", content: systemPrompt },
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
