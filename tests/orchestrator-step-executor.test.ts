import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { ScopyLogger } from "../src/logging/scopy-logger.js";
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
import { FilesystemTool } from "../src/tools/filesystem-tool.js";

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
    workspace: string;
  }) => Promise<void>,
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "scopy-step-executor-test-"));
  const workspace = join(home, "workspace");
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
    await callback({ executor, plans, runs, rules, approvals, runtime, gateway, workspace });
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


test("executePlanned resolves the saved action and still requires exact tool approval", async () => {
  await withExecutor(async ({ executor, plans, runs, rules, approvals, gateway }) => {
    const plan = plans.create("Create a test file", {
      summary: "Write a single file in the workspace.",
      steps: [{
        id: "step-1", title: "Write test file",
        description: "Create the file with the supplied test content.",
        expectedOutput: "The file is written.",
        risk: "low", dependsOn: [],
        action: {
          tool: "filesystem", action: "write", target: "execution-check.txt",
          payload: { content: "Scopy guarded execution test" },
        },
      }],
    });
    plans.review(plan.id, "approved", "user:local");
    const runId = runs.start(plan.id, "user:local").id;
    rules.setRule({
      actorId: "user:local", tool: "filesystem", action: "write",
      targetPattern: "*", effect: "approval_required",
    });
    gateway.register("filesystem", "Test filesystem adapter", (request) => ({
      target: request.target,
      content: request.payload?.content,
    }));

    let approvalId = "";
    await assert.rejects(executor.executePlanned(runId, "step-1"), (error: unknown) => {
      assert.ok(error instanceof PlanStepApprovalRequiredError);
      approvalId = error.approval.id;
      return true;
    });
    assert.equal(runs.getById(runId)?.steps[0]?.status, "ready");
    approvals.approve(approvalId, "user:local");
    const result = await executor.executePlanned(runId, "step-1", {}, approvalId);
    assert.equal(result.run.status, "succeeded");
    assert.equal((result.execution.output as { target: string }).target, "execution-check.txt");
    assert.equal(approvals.getById(approvalId)?.status, "consumed");
  });
});


test("guarded step execution emits structured metadata without logging file content", async () => {
  const logHome = mkdtempSync(join(tmpdir(), "scopy-execution-log-test-"));
  try {
    await withExecutor(async ({ plans, runs, rules, approvals, runtime, gateway }) => {
      const plan = plans.create("Write a private note", {
        summary: "Write one file through the filesystem tool.",
        steps: [{
          id: "step-1", title: "Write private note",
          description: "Write a test file.",
          expectedOutput: "The file is written.",
          risk: "low", dependsOn: [],
          action: {
            tool: "filesystem", action: "write", target: "private.txt",
            payload: { content: "NEVER_LOG_THIS_PRIVATE_CONTENT" },
          },
        }],
      });
      plans.review(plan.id, "approved", "user:local");
      const runId = runs.start(plan.id, "user:local").id;
      rules.setRule({
        actorId: "user:local", tool: "filesystem", action: "write",
        targetPattern: "*", effect: "allow",
      });
      gateway.register("filesystem", "Logging test adapter", (request) => ({ written: request.target }));
      const logger = new ScopyLogger(join(logHome, "logs"));
      const executor = new PlanStepExecutor(runs, new PolicyEngine(rules), approvals, runtime, logger);
      const result = await executor.executePlanned(runId, "step-1");
      assert.equal(result.run.status, "succeeded");
      const log = readFileSync(join(logHome, "logs", "scopy.log"), "utf8");
      assert.ok(log.includes("plan.step.execution.started"));
      assert.ok(log.includes("plan.step.execution.succeeded"));
      assert.ok(!log.includes("NEVER_LOG_THIS_PRIVATE_CONTENT"));
    });
  } finally {
    rmSync(logHome, { recursive: true, force: true });
  }
});

test("run executor processes saved filesystem actions sequentially and pauses for approval", async () => {
  await withExecutor(async ({ plans, runs, rules, approvals, gateway, executor, workspace }) => {
    const plan = plans.create("Write and verify a workspace note", {
      summary: "Create a file, then read it back through guarded filesystem actions.",
      steps: [
        {
          id: "step-1", title: "Write note", description: "Create the note in the workspace.",
          expectedOutput: "The note is written.", risk: "low", dependsOn: [],
          action: { tool: "filesystem", action: "write", target: "execution-check.txt", payload: { content: "Scopy sequential execution" } },
        },
        {
          id: "step-2", title: "Verify note", description: "Read the note back from the workspace.",
          expectedOutput: "The note content is verified.", risk: "low", dependsOn: ["step-1"],
          action: { tool: "filesystem", action: "read", target: "execution-check.txt" },
        },
      ],
    });
    plans.review(plan.id, "approved", "user:local");
    const runId = runs.start(plan.id, "user:local").id;
    new FilesystemTool({ workspaceRoot: workspace }).register(gateway);
    rules.setRule({ actorId: "user:local", tool: "filesystem", action: "write", targetPattern: "execution-check.txt", effect: "approval_required" });
    rules.setRule({ actorId: "user:local", tool: "filesystem", action: "read", targetPattern: "execution-check.txt", effect: "allow" });

    const paused = await executor.executeReadySteps(runId);
    assert.deepEqual(paused.executedStepIds, []);
    assert.equal(paused.pausedAt?.reason, "approval_required");
    const approvalId = paused.pausedAt?.approval?.id;
    assert.ok(approvalId);
    assert.equal(runs.getById(runId)?.steps[0]?.status, "ready");

    approvals.approve(approvalId, "user:local");
    const completed = await executor.executeReadySteps(runId, {}, approvalId);
    assert.deepEqual(completed.executedStepIds, ["step-1", "step-2"]);
    assert.equal(completed.run.status, "succeeded");
    assert.equal(completed.run.steps[1]?.result, '"Scopy sequential execution"');
    assert.equal(approvals.getById(approvalId)?.status, "consumed");
    assert.equal(readFileSync(join(workspace, "execution-check.txt"), "utf8"), "Scopy sequential execution");
  });
});

test("run executor pauses at a manual step without running later typed actions", async () => {
  await withExecutor(async ({ plans, runs, executor }) => {
    const plan = plans.create("Pause at manual work", {
      summary: "Manual work must be completed before a later filesystem action.",
      steps: [
        { id: "step-1", title: "Review content", description: "A human reviews the content.", expectedOutput: "The review is complete.", risk: "low", dependsOn: [] },
        { id: "step-2", title: "Write approved note", description: "Write only after review.", expectedOutput: "The note is written.", risk: "low", dependsOn: ["step-1"], action: { tool: "filesystem", action: "write", target: "after-review.txt", payload: { content: "reviewed" } } },
      ],
    });
    plans.review(plan.id, "approved", "user:local");
    const runId = runs.start(plan.id, "user:local").id;
    const result = await executor.executeReadySteps(runId);
    assert.equal(result.pausedAt?.reason, "manual_step");
    assert.equal(result.pausedAt?.stepId, "step-1");
    assert.deepEqual(result.executedStepIds, []);
    assert.equal(result.run.steps[0]?.status, "ready");
    assert.equal(result.run.steps[1]?.status, "pending");
  });
});

test("run executor does not start a second action while a step is already in flight", async () => {
  await withExecutor(async ({ plans, runs, executor }) => {
    const runId = await createRun(plans, runs);
    runs.startStep(runId, "step-1");
    const result = await executor.executeReadySteps(runId);
    assert.equal(result.pausedAt?.reason, "in_flight");
    assert.equal(result.pausedAt?.stepId, "step-1");
    assert.equal(result.run.steps[0]?.status, "running");
  });
});
