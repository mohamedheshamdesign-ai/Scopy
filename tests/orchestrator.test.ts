import assert from "node:assert/strict";
import { ProviderRouter } from "../src/ai/provider-router.js";
import type { ModelProvider } from "../src/ai/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { parsePlannerResponse, validateGeneratedPlan, validatePlanAction } from "../src/orchestrator/plan.js";
import { resolvePlanAction } from "../src/orchestrator/action-resolver.js";
import { PlanNotFoundError, PlanRepository } from "../src/orchestrator/plan-repository.js";
import { generateDraftPlan } from "../src/orchestrator/planner.js";

const validDraft = {
  summary: "Prepare and verify a safe local backup.",
  steps: [
    {
      id: "step-1",
      title: "Inspect the data directory",
      description: "List the current files and identify the database and user data.",
      expectedOutput: "A verified inventory of the data directory.",
      risk: "low",
      dependsOn: [],
    },
    {
      id: "step-2",
      title: "Create a backup copy",
      description: "Copy the identified data into a new timestamped backup directory.",
      expectedOutput: "A separate backup copy with the original files preserved.",
      risk: "medium",
      dependsOn: ["step-1"],
    },
  ],
} as const;

test("planner validates ordered steps and parses fenced JSON", () => {
  const parsed = parsePlannerResponse(" ```json\n" + JSON.stringify(validDraft) + "\n``` ");
  assert.equal(parsed.steps.length, 2);
  assert.deepEqual(parsed.steps[1]?.dependsOn, ["step-1"]);
});

test("planner rejects duplicate IDs, unknown dependencies, and dependency cycles", () => {
  assert.throws(() => validateGeneratedPlan({
    ...validDraft,
    steps: [validDraft.steps[0], { ...validDraft.steps[1], id: "step-1" }],
  }), /unique/);
  assert.throws(() => validateGeneratedPlan({
    ...validDraft,
    steps: [{ ...validDraft.steps[0], dependsOn: ["missing-step"] }],
  }), /unknown step/);
  assert.throws(() => validateGeneratedPlan({
    ...validDraft,
    steps: [
      { ...validDraft.steps[0], dependsOn: ["step-2"] },
      validDraft.steps[1],
    ],
  }), /cycle/);
  assert.throws(() => parsePlannerResponse("not JSON"), /valid JSON/);
});

test("plans persist with ordered steps and approval or rejection is audited", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-plan-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const repository = new PlanRepository(database);
    const created = repository.create("Prepare a safe local backup", validDraft);
    assert.equal(created.status, "draft");
    assert.equal(created.steps.length, 2);
    assert.deepEqual(created.steps[1]?.dependsOn, ["step-1"]);
    assert.equal(repository.list().length, 1);

    const approved = repository.review(created.id, "approved", "user:local");
    assert.equal(approved.status, "approved");
    assert.equal(approved.reviewedBy, "user:local");
    assert.throws(() => repository.review(created.id, "rejected", "user:local"), /already reviewed/);
    assert.throws(() => repository.review("missing-plan", "approved", "user:local"), PlanNotFoundError);

    const events = database.prepare(
      "SELECT event_type FROM audit_events WHERE entity_type = 'orchestrator_plan' ORDER BY rowid",
    ).all() as Array<{ event_type: string }>;
    assert.deepEqual(events.map((event) => event.event_type), [
      "orchestrator.plan.created",
      "orchestrator.plan.approved",
    ]);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("rejected plans cannot later be approved", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-plan-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const repository = new PlanRepository(database);
    const created = repository.create("A small test goal", {
      summary: "A minimal plan.",
      steps: [validDraft.steps[0]!],
    });
    assert.equal(repository.review(created.id, "rejected", "user:local").status, "rejected");
    assert.throws(() => repository.review(created.id, "approved", "user:local"), /already reviewed/);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});


test("typed filesystem actions are validated and persist with the plan", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-plan-action-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const repository = new PlanRepository(database);
    const draft = {
      summary: "Create one safe workspace note.",
      steps: [{
        id: "step-1", title: "Write the note",
        description: "Create the requested note in the workspace.",
        expectedOutput: "The note exists in the workspace.",
        risk: "low", dependsOn: [],
        action: {
          tool: "filesystem", action: "write", target: "notes/execution-check.txt",
          payload: { content: "Scopy test" },
        },
      }],
    } as const;
    const created = repository.create("Create a workspace note", draft);
    assert.deepEqual(created.steps[0]?.action, draft.steps[0]?.action);
    assert.throws(() => validateGeneratedPlan({
      ...draft,
      steps: [{ ...draft.steps[0], action: { ...draft.steps[0].action, target: "../outside.txt" } }],
    }), /workspace-relative/);
    assert.throws(() => validateGeneratedPlan({
      ...draft,
      steps: [{ ...draft.steps[0], action: { ...draft.steps[0].action, tool: "unsupported" } }],
    }), /unsupported tool/);
    assert.throws(() => validateGeneratedPlan({
      ...draft,
      steps: [{ ...draft.steps[0], action: { ...draft.steps[0].action, target: "C:/outside.txt" } }],
    }), /workspace-relative/);
    const rootListing = validateGeneratedPlan({
      ...draft,
      steps: [{
        ...draft.steps[0],
        action: { tool: "filesystem", action: "list", target: "." },
      }],
    });
    assert.deepEqual(rootListing.steps[0]?.action, { tool: "filesystem", action: "list", target: "." });
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("specialist-guided planning adds domain context but still creates an unapproved draft", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-specialist-plan-test-"));
  const database = openDatabase(loadConfig(home, {}));
  let capturedSystemPrompt = "";
  const provider: ModelProvider = {
    descriptor: {
      id: "test-local", label: "Test local provider", dataBoundary: "local", models: ["test-model"],
      capabilities: { chat: true, streaming: false, tools: false, vision: false, maxContextTokens: 2048 },
    },
    async health() { return { healthy: true, checkedAt: new Date().toISOString(), detail: "test" }; },
    async generate(request) {
      capturedSystemPrompt = request.messages[0]?.content ?? "";
      return { providerId: "test-local", model: "test-model", text: JSON.stringify(validDraft), durationMs: 1 };
    },
  };
  try {
    const router = new ProviderRouter(database);
    router.register(provider);
    const repository = new PlanRepository(database);
    const plan = await generateDraftPlan(router, "test-local", repository, "Plan a brand refresh", "Act as a senior brand designer. Focus on positioning and identity systems.");
    assert.equal(plan.status, "draft");
    assert.match(capturedSystemPrompt, /SPECIALIST CONTEXT/);
    assert.match(capturedSystemPrompt, /senior brand designer/);
    assert.match(capturedSystemPrompt, /Never include shell commands/);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});


test("typed browser and terminal plan actions validate and resolve through actor binding", () => {
  const browser = validatePlanAction({
    tool: "browser", action: "open", target: "https://example.com/research",
  }, "browser-step");
  assert.deepEqual(browser, {
    tool: "browser", action: "open", target: "https://example.com/research",
  });
  assert.deepEqual(resolvePlanAction(browser, "user:local"), {
    actorId: "user:local", tool: "browser", action: "open",
    target: "https://example.com/research", payload: {},
  });

  const terminal = validatePlanAction({
    tool: "terminal", action: "run", target: ".",
    payload: { executable: "powershell.exe", args: ["-NoProfile", "-Command", "Get-ChildItem"], timeoutMs: 30000 },
  }, "terminal-step");
  assert.deepEqual(resolvePlanAction(terminal, "user:local"), {
    actorId: "user:local", tool: "terminal", action: "run", target: ".",
    payload: { executable: "powershell.exe", args: ["-NoProfile", "-Command", "Get-ChildItem"], timeoutMs: 30000 },
  });

  assert.throws(() => validatePlanAction({
    tool: "browser", action: "open", target: "javascript:alert(1)",
  }, "unsafe-browser"), /http\/https/);
  assert.throws(() => validatePlanAction({
    tool: "terminal", action: "run", target: "../outside",
    payload: { executable: "powershell.exe", args: [], timeoutMs: 30000 },
  }, "unsafe-terminal"), /workspace-relative/);
  assert.throws(() => validatePlanAction({
    tool: "terminal", action: "run", target: ".",
    payload: { executable: "cmd.exe", args: [], timeoutMs: 30000 },
  }, "unsupported-executable"), /not allowed/);
});
