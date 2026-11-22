import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { PlanRepository } from "../src/orchestrator/plan-repository.js";
import { PlanRunRepository } from "../src/orchestrator/run-repository.js";

const draft = {
  summary: "A two-step dependency test plan.",
  steps: [
    {
      id: "step-1",
      title: "Prepare the workspace",
      description: "Inspect and prepare the local workspace.",
      expectedOutput: "Workspace is ready.",
      risk: "low",
      dependsOn: [],
    },
    {
      id: "step-2",
      title: "Complete the work",
      description: "Perform the work after preparation.",
      expectedOutput: "Work is complete.",
      risk: "medium",
      dependsOn: ["step-1"],
    },
  ],
} as const;

async function withRunRepositories(
  callback: (plans: PlanRepository, runs: PlanRunRepository, database: ReturnType<typeof openDatabase>) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "scopy-run-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    await callback(new PlanRepository(database), new PlanRunRepository(database), database);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
}

async function approvedPlan(plans: PlanRepository): Promise<string> {
  const plan = plans.create("Test orchestrator run lifecycle", draft);
  plans.review(plan.id, "approved", "user:local");
  return plan.id;
}

test("run start requires an approved plan and initializes dependency-ready states", async () => {
  await withRunRepositories(async (plans, runs) => {
    const plan = plans.create("A draft plan", draft);
    assert.throws(() => runs.start(plan.id, "user:local"), /approved/);

    plans.review(plan.id, "approved", "user:local");
    const run = runs.start(plan.id, "user:local");
    assert.equal(run.status, "running");
    assert.equal(run.steps[0]?.status, "ready");
    assert.equal(run.steps[1]?.status, "pending");
    assert.deepEqual(runs.getLatestCheckpoint(run.id), run);
  });
});

test("run enforces dependency order and completes only after every step succeeds", async () => {
  await withRunRepositories(async (plans, runs, database) => {
    const run = runs.start(await approvedPlan(plans), "user:local");
    assert.throws(() => runs.startStep(run.id, "step-2"), /ready/);

    runs.startStep(run.id, "step-1");
    assert.throws(() => runs.startStep(run.id, "step-1"), /ready/);
    assert.throws(() => runs.startStep(run.id, "step-2"), /ready/);

    const afterFirst = runs.completeStep(run.id, "step-1", "Workspace inspected.");
    assert.equal(afterFirst.steps[0]?.status, "succeeded");
    assert.equal(afterFirst.steps[1]?.status, "ready");
    assert.equal(afterFirst.status, "running");

    runs.startStep(run.id, "step-2");
    const completed = runs.completeStep(run.id, "step-2", "Work delivered.");
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.steps[1]?.result, "Work delivered.");
    assert.ok(completed.finishedAt);

    const checkpoint = runs.getLatestCheckpoint(run.id) as { status?: string };
    assert.equal(checkpoint.status, "succeeded");

    const audit = database.prepare(
      "SELECT event_type FROM audit_events WHERE entity_type = 'orchestrator_run' ORDER BY rowid",
    ).all() as Array<{ event_type: string }>;
    assert.ok(audit.some((event) => event.event_type === "orchestrator.run.succeeded"));
  });
});

test("failed step can be explicitly retried through run resume", async () => {
  await withRunRepositories(async (plans, runs) => {
    const run = runs.start(await approvedPlan(plans), "user:local");
    runs.startStep(run.id, "step-1");
    const failed = runs.failStep(run.id, "step-1", "Temporary local failure.");
    assert.equal(failed.status, "failed");
    assert.equal(failed.steps[0]?.status, "failed");
    assert.throws(() => runs.startStep(run.id, "step-1"), /running plan run/);

    const resumed = runs.resume(run.id);
    assert.equal(resumed.status, "running");
    assert.equal(resumed.steps[0]?.status, "ready");
    runs.startStep(run.id, "step-1");
    const retried = runs.getById(run.id)!;
    assert.equal(retried.steps[0]?.attemptCount, 2);
    runs.completeStep(run.id, "step-1");
    runs.startStep(run.id, "step-2");
    assert.equal(runs.completeStep(run.id, "step-2").status, "succeeded");
  });
});

test("run cancellation skips unfinished steps and terminal runs cannot be changed", async () => {
  await withRunRepositories(async (plans, runs) => {
    const run = runs.start(await approvedPlan(plans), "user:local");
    const cancelled = runs.cancel(run.id);
    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.steps.every((step) =>
      step.status === "skipped" || step.status === "succeeded"));
    assert.throws(() => runs.resume(run.id), /failed plan run/);
    assert.throws(() => runs.startStep(run.id, "step-1"), /running plan run/);
  });
});

test("run rejects unknown steps, invalid transitions, and oversized checkpoint results", async () => {
  await withRunRepositories(async (plans, runs) => {
    const run = runs.start(await approvedPlan(plans), "user:local");
    assert.throws(() => runs.startStep(run.id, "missing-step"), /not found/);
    assert.throws(() => runs.completeStep(run.id, "step-1"), /running step/);
    runs.startStep(run.id, "step-1");
    assert.throws(() => runs.completeStep(run.id, "step-1", "x".repeat(4_001)), /4000/);
  });
});


test("typed action steps are copied into runs and cannot be manually completed", async () => {
  await withRunRepositories(async (plans, runs) => {
    const plan = plans.create("Execute a guarded workspace write", {
      summary: "Write a file through the guarded tool path.",
      steps: [{
        id: "step-1", title: "Write the file",
        description: "Create a workspace file.",
        expectedOutput: "The file is written.",
        risk: "low", dependsOn: [],
        action: {
          tool: "filesystem", action: "write", target: "execution-check.txt",
          payload: { content: "guarded" },
        },
      }],
    });
    plans.review(plan.id, "approved", "user:local");
    const run = runs.start(plan.id, "user:local");
    assert.deepEqual(run.steps[0]?.action, plan.steps[0]?.action);
    assert.throws(() => runs.startStep(run.id, "step-1"), /guarded execution/);
    runs.startStep(run.id, "step-1", true);
    assert.throws(() => runs.completeStep(run.id, "step-1", "forged success"), /guarded executor/);
    const completed = runs.completeStep(run.id, "step-1", "verified tool result", true);
    assert.equal(completed.status, "succeeded");
  });
});


test("interrupted run recovery requires explicit process-stop confirmation and never retries automatically", async () => {
  await withRunRepositories(async (plans, runs) => {
    const plan = plans.create("Recover an interrupted step", {
      summary: "One step is in flight.",
      steps: [{
        id: "step-1", title: "In-flight step",
        description: "A step that was interrupted.",
        expectedOutput: "The result is reviewed.",
        risk: "low", dependsOn: [],
      }],
    });
    plans.review(plan.id, "approved", "user:local");
    const run = runs.start(plan.id, "user:local");
    runs.startStep(run.id, "step-1");
    assert.throws(() => runs.recoverInterrupted(run.id), /Confirm the previous Scopy process/);
    const recovered = runs.recoverInterrupted(run.id, true);
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.steps[0]?.status, "failed");
    assert.match(recovered.steps[0]?.error ?? "", /side effects are unknown/);
    const resumed = runs.resume(run.id);
    assert.equal(resumed.status, "running");
    assert.equal(resumed.steps[0]?.status, "ready");
    assert.equal(resumed.steps[0]?.attemptCount, 1);
  });
});
