import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { ApprovalService } from "../src/permissions/approval-service.js";
import { ExecutionGuard } from "../src/permissions/execution-guard.js";
import { PermissionRepository } from "../src/permissions/permission-repository.js";
import { PolicyEngine } from "../src/permissions/policy-engine.js";
import { RuntimeEngine, RuntimeCancelledError, RuntimeOutputLimitError, RuntimeTimeoutError } from "../src/runtime/runtime-engine.js";
import { ToolGateway, type ToolExecutionContext } from "../src/tools/tool-gateway.js";

async function withRuntime(run: (context: {
  runtime: RuntimeEngine;
  gateway: ToolGateway;
  rules: PermissionRepository;
  database: ReturnType<typeof openDatabase>;
}) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "scopy-runtime-test-"));
  const database = openDatabase(loadConfig(home));
  const rules = new PermissionRepository(database);
  const policy = new PolicyEngine(rules);
  const approvals = new ApprovalService(database, policy);
  const gateway = new ToolGateway(new ExecutionGuard(database, policy, approvals));
  const runtime = new RuntimeEngine(database, gateway);
  try {
    await run({ runtime, gateway, rules, database });
  } finally {
    database.close();
    rmSync(home, { recursive: true, force: true });
  }
}

function allow(rules: PermissionRepository, tool: string, action: string): void {
  rules.setRule({
    actorId: "agent:test", tool, action, targetPattern: "*", effect: "allow",
  });
}

function request(tool: string, action: string) {
  return { actorId: "agent:test", tool, action, target: "test-target" };
}

function waitForAbort(context?: ToolExecutionContext): Promise<never> {
  return new Promise((_, reject) => {
    if (!context) {
      reject(new Error("Runtime context was not supplied."));
      return;
    }
    if (context.signal.aborted) {
      reject(context.signal.reason);
      return;
    }
    context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
  });
}

test("runtime enforces timeout and persists timed_out status", async () => {
  await withRuntime(async ({ runtime, gateway, rules }) => {
    allow(rules, "slow", "run");
    gateway.register("slow", "Wait until aborted", (_request, context) => waitForAbort(context));
    await assert.rejects(
      runtime.execute(request("slow", "run"), { timeoutMs: 20 }),
      RuntimeTimeoutError,
    );
    const rows = runtime["database"].prepare(
      "SELECT status FROM execution_runs ORDER BY started_at DESC LIMIT 1",
    ).get() as { status: string };
    assert.equal(rows.status, "timed_out");
  });
});

test("runtime cancellation stops awaiting cooperative tools and records cancelled status", async () => {
  await withRuntime(async ({ runtime, gateway, rules }) => {
    allow(rules, "slow", "run");
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    gateway.register("slow", "Wait until aborted", (_request, context) => {
      started();
      return waitForAbort(context);
    });
    let runId = "";
    const execution = runtime.execute(request("slow", "run"), {
      timeoutMs: 5_000,
      onStarted: (id) => { runId = id; },
    });
    await didStart;
    assert.ok(runId);
    assert.equal(runtime.cancel(runId), true);
    await assert.rejects(execution, RuntimeCancelledError);
    assert.equal(runtime.getRun(runId)?.status, "cancelled");
    assert.equal(runtime.cancel(runId), false);
  });
});

test("runtime rejects outputs larger than the configured byte limit", async () => {
  await withRuntime(async ({ runtime, gateway, rules }) => {
    allow(rules, "echo", "run");
    gateway.register("echo", "Return a string", () => "x".repeat(100));
    await assert.rejects(
      runtime.execute(request("echo", "run"), { maxOutputBytes: 32 }),
      RuntimeOutputLimitError,
    );
  });
});

test("runtime persists checkpoints and supplies the latest checkpoint to a resumed run", async () => {
  await withRuntime(async ({ runtime, gateway, rules }) => {
    allow(rules, "worker", "run");
    gateway.register("worker", "Checkpoint and resume", async (_request, context) => {
      if (context?.previousCheckpoint) return { resumed: context.previousCheckpoint };
      await context?.checkpoint({ step: 2, cursor: "abc" });
      return { completed: true };
    });

    const first = await runtime.execute<{ completed: boolean }>(request("worker", "run"));
    assert.deepEqual(runtime.getLatestCheckpoint(first.runId), { step: 2, cursor: "abc" });

    const second = await runtime.execute<{ resumed: unknown }>(
      request("worker", "run"),
      { resumeFromRunId: first.runId },
    );
    assert.deepEqual(second.output, { resumed: { step: 2, cursor: "abc" } });
    assert.equal(runtime.getRun(first.runId)?.status, "succeeded");
    assert.equal(runtime.getRun(second.runId)?.status, "succeeded");
  });
});
