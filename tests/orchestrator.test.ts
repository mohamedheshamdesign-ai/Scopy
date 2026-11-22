import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { parsePlannerResponse, validateGeneratedPlan } from "../src/orchestrator/plan.js";
import { PlanNotFoundError, PlanRepository } from "../src/orchestrator/plan-repository.js";

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
      steps: [{ ...draft.steps[0], action: { ...draft.steps[0].action, tool: "terminal" } }],
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
