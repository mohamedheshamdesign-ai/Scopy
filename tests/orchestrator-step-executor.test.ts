import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { ApprovalService } from "../src/permissions/approval-service.js";
import { ExecutionGuard, PermissionDeniedError } from "../src/permissions/execution-guard.js";
import { PermissionRepository } from "../src/permissions/permission-repository.js";
import { PolicyEngine } from "../src/permissions/policy-engine.js";
import { RuntimeEngine } from "../src/runtime/runtime-engine.js";
import { PlanRepository } from "../src/orchestrator/plan-repository.js";
import { PlanStepExecutor, PlanStepApprovalRequiredError } from "../src/orchestrator/step-executor.js";
import { PlanRunRepository } from "../src/orchestrator/run-repository.js";
import { ToolGateway } from "../src/tools/tool-gateway.js";

const draft = {
  summary: "A one-step execution test plan.",
  steps: [{
    id: "step-1",
    title: "Run a registered action",
    description: "Execute a deterministic registered test action.",
    expectedOutput: "The action returns a result.",
    risk: "low",
    dependsOn: [],
  }],
} as const;

async function withExecutor(
  callback: (context: {
    executor: PlanStepExecutor;
    plans: PlanRepository;
    runs: PlanRunRepository;
    rules: PermissionRepository;
    approvals: ApprovalService;
    runtime: RuntimeEngine;
    gateway: ToolGateway;
  }) => Promise<void>,
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "scopy-step-executor-test-"));
  const database = openDatabase(loadConfig(home));
  const rules = new PermissionRepository(database);
  const policy = new PolicyEngine(rules);
  const approvals = new ApprovalService(database, policy);
  const gateway = new ToolGateway(new ExecutionGuard(database, policy, approvals));
  const runtime = new RuntimeEngine(database, gateway);
  const plans = new PlanRepository(database);
  const runs = new PlanRunRepository(database);
  const executor = new PlanStepExecutor(runs, policy, approvals, runtime);
  try {
    await callback({ executor, plans, runs, rules, approvals, runtime, gateway });
  } finally {
    database.close();
    rmSync(home, { recursive: true, force: true });
  }
}

async function createRun(plans: PlanRepository, runs: PlanRunRepository): Promise<string> {
  const plan = plans.create("Test guarded plan execution", draft);
  plans.review(plan.id, "approved", "user:local");
  return runs.start(plan.id, "user:local").id;
}

const action = (overrides: Partial<{
  actorId: string; tool: string; action: string; target: string;
  payload: Readonly<Record<string, unknown>>;
}> = {}) => ({
  actorId: "user:local",
  tool: "test-tool",
  action: "perform",
  target: "safe-target",
  ...overrides,
});

test("plan step executor runs registered tools through runtime and completes the step", async () => {
  await withExecutor(async ({ executor, plans, runs, rules, gateway, runtime }) => {
    const runId = await createRun(plans, runs);
    rules.setRule({
      actorId: "user:local", tool: "test-tool", action: "perform",
      targetPattern: "*", effect: "allow",
    });
    gateway.register("test-tool", "A deterministic test tool", () => ({ saved: true }));

    const result = await executor.execute<{ saved: boolean }>(runId, "step-1", action());
    assert.deepEqual(result.execution.output, { saved: true });
    assert.equal(result.run.status, "succeeded");
    assert.equal(result.run.steps[0]?.status, "succeeded");
    assert.equal(runtime.getRun(result.execution.runId)?.status, "succeeded");
  });
});

test("approval-required plan action stays ready until exact approval is reviewed", async () => {
  await withExecutor(async ({ executor, plans, runs, rules, approvals, gateway }) => {
    const runId = await createRun(plans, runs);
    rules.setRule({
      actorId: "user:local", tool: "test-tool", action: "perform",
      targetPattern: "*", effect: "approval_required",
    });
    gateway.register("test-tool", "An approval-gated test tool", () => "done");

    let pendingId = "";
    await assert.rejects(
      executor.execute(runId, "step-1", action()),
      (error: unknown) => {
        assert.ok(error instanceof PlanStepApprovalRequiredError);
        pendingId = error.approval.id;
        return true;
      },
    );
    assert.equal(runs.getById(runId)?.steps[0]?.status, "ready");
    assert.equal(approvals.getById(pendingId)?.status, "pending");

    approvals.approve(pendingId, "user:local");
    await assert.rejects(
      executor.execute(runId, "step-1", action({ target: "different-target" }), {}, pendingId),
      PermissionDeniedError,
    );
    assert.equal(runs.getById(runId)?.steps[0]?.status, "ready");

    const completed = await executor.execute(runId, "step-1", action(), {}, pendingId);
    assert.equal(completed.run.status, "succeeded");
    assert.equal(approvals.getById(pendingId)?.status, "consumed");
  });
});

test("plan step executor denies unconfigured actions and mismatched actors without starting the step", async () => {
  await withExecutor(async ({ executor, plans, runs, gateway }) => {
    const runId = await createRun(plans, runs);
    gateway.register("test-tool", "A tool that must not run", () => {
      throw new Error("The handler must not be called.");
    });

    await assert.rejects(executor.execute(runId, "step-1", action()), PermissionDeniedError);
    await assert.rejects(
      executor.execute(runId, "step-1", action({ actorId: "agent:untrusted" })),
      PermissionDeniedError,
    );
    assert.equal(runs.getById(runId)?.steps[0]?.status, "ready");
  });
});

test("failed tool execution records a failed step and run", async () => {
  await withExecutor(async ({ executor, plans, runs, rules, gateway }) => {
    const runId = await createRun(plans, runs);
    rules.setRule({
      actorId: "user:local", tool: "test-tool", action: "perform",
      targetPattern: "*", effect: "allow",
    });
    gateway.register("test-tool", "A failing test tool", () => {
      throw new Error("Simulated tool failure.");
    });

    await assert.rejects(executor.execute(runId, "step-1", action()), /Simulated tool failure/);
    const failed = runs.getById(runId)!;
    assert.equal(failed.status, "failed");
    assert.equal(failed.steps[0]?.status, "failed");
  });
});
