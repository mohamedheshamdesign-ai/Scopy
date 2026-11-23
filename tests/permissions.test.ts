import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { ApprovalService } from "../src/permissions/approval-service.js";
import { ExecutionGuard, ApprovalRequiredError, PermissionDeniedError } from "../src/permissions/execution-guard.js";
import { PermissionRepository } from "../src/permissions/permission-repository.js";
import { PolicyEngine } from "../src/permissions/policy-engine.js";
import type { ActionRequest } from "../src/permissions/types.js";

function withServices(run: (services: {
  database: ReturnType<typeof openDatabase>;
  rules: PermissionRepository;
  policy: PolicyEngine;
  approvals: ApprovalService;
  guard: ExecutionGuard;
}) => Promise<void> | void): Promise<void> {
  const homeDir = mkdtempSync(join(tmpdir(), "scopy-permissions-test-"));
  const database = openDatabase(loadConfig(homeDir));
  const rules = new PermissionRepository(database);
  const policy = new PolicyEngine(rules);
  const approvals = new ApprovalService(database, policy);
  const guard = new ExecutionGuard(database, policy, approvals);
  return Promise.resolve()
    .then(() => run({ database, rules, policy, approvals, guard }))
    .finally(() => {
      database.close();
      rmSync(homeDir, { recursive: true, force: true });
    });
}

const sensitiveAction: ActionRequest = {
  actorId: "agent:marketing",
  tool: "social",
  action: "publish",
  target: "account:brand",
  payload: { text: "Approved copy" },
};

test("default deny blocks actions without a matching rule", async () => {
  await withServices(async ({ guard }) => {
    let executed = false;
    await assert.rejects(
      guard.execute(sensitiveAction, () => { executed = true; }),
      PermissionDeniedError,
    );
    assert.equal(executed, false);
  });
});

test("allow rule executes and records a successful audit trail", async () => {
  await withServices(async ({ rules, guard, database }) => {
    rules.setRule({ actorId: "agent:research", tool: "browser", action: "read", effect: "allow" });
    const result = await guard.execute({
      actorId: "agent:research", tool: "browser", action: "read", target: "https://example.com",
    }, () => "page content");
    assert.equal(result, "page content");
    const count = database.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'tool.execution.succeeded'",
    ).get() as { count: number };
    assert.equal(count.count, 1);
  });
});

test("approval is required, bound to exact input, and consumed once", async () => {
  await withServices(async ({ rules, approvals, guard }) => {
    rules.setRule({
      actorId: "agent:marketing", tool: "social", action: "publish",
      targetPattern: "account:brand", effect: "approval_required",
    });
    let executed = false;
    await assert.rejects(
      guard.execute(sensitiveAction, () => { executed = true; }),
      ApprovalRequiredError,
    );
    assert.equal(executed, false);

    const pending = approvals.request(sensitiveAction);
    assert.equal(pending.status, "pending");
    assert.deepEqual(pending.payload, { text: "Approved copy" });
    assert.equal(approvals.listPending().length, 1);
    approvals.approve(pending.id, "owner");
    assert.equal(approvals.getById(pending.id)?.status, "approved");

    const changedAction = { ...sensitiveAction, payload: { text: "Changed after approval" } };
    await assert.rejects(
      guard.execute(changedAction, () => { executed = true; }, pending.id),
      PermissionDeniedError,
    );
    assert.equal(executed, false);

    const result = await guard.execute(sensitiveAction, () => {
      executed = true;
      return "published";
    }, pending.id);
    assert.equal(result, "published");
    assert.equal(approvals.getById(pending.id)?.status, "consumed");

    await assert.rejects(
      guard.execute(sensitiveAction, () => { executed = true; }, pending.id),
      PermissionDeniedError,
    );
  });
});

test("rejected approvals cannot execute", async () => {
  await withServices(async ({ rules, approvals, guard }) => {
    rules.setRule({
      actorId: "agent:marketing", tool: "social", action: "publish", effect: "approval_required",
    });
    const pending = approvals.request(sensitiveAction);
    approvals.reject(pending.id, "owner");
    let executed = false;
    await assert.rejects(
      guard.execute(sensitiveAction, () => { executed = true; }, pending.id),
      PermissionDeniedError,
    );
    assert.equal(executed, false);
  });
});

test("a specific deny overrides a broad allow rule", async () => {
  await withServices(({ rules, policy }) => {
    rules.setRule({ actorId: "*", tool: "filesystem", action: "read", effect: "allow" });
    rules.setRule({
      actorId: "agent:marketing", tool: "filesystem", action: "read",
      targetPattern: "C:\\private\\*",
      effect: "deny",
    });
    assert.equal(policy.evaluate({
      actorId: "agent:marketing", tool: "filesystem", action: "read",
      target: "c:/private/secrets.txt",
    }).effect, "deny");
  });
});

test("a more specific tool-and-action deny beats a broad actor allow", async () => {
  await withServices(({ rules, policy }) => {
    rules.setRule({ actorId: "agent:marketing", tool: "*", action: "*", effect: "allow" });
    rules.setRule({
      actorId: "*", tool: "filesystem", action: "read",
      targetPattern: "E:\\Scopy\\private\\*",
      effect: "deny",
    });
    assert.equal(policy.evaluate({
      actorId: "agent:marketing", tool: "filesystem", action: "read",
      target: "E:\\Scopy\\private\\credentials.txt",
    }).effect, "deny");
  });
});

test("approval_required wins over an equally specific allow rule", async () => {
  await withServices(({ rules, policy }) => {
    rules.setRule({
      actorId: "agent:operations", tool: "email", action: "*",
      effect: "allow",
    });
    rules.setRule({
      actorId: "agent:operations", tool: "*", action: "send",
      effect: "approval_required",
    });
    assert.equal(policy.evaluate({
      actorId: "agent:operations", tool: "email", action: "send",
      target: "contact:customer",
    }).effect, "approval_required");
  });
});

test("permission rules can be listed and removed with an audit event", async () => {
  await withServices(async ({ rules, database }) => {
    const rule = rules.setRule({
      actorId: "user:local", tool: "filesystem", action: "write",
      targetPattern: "notes/*", effect: "approval_required",
    });
    assert.equal(rules.list().some((item) => item.id === rule.id), true);
    assert.equal(rules.removeRule(rule.id), true);
    assert.equal(rules.removeRule(rule.id), false);
    assert.equal(rules.list().some((item) => item.id === rule.id), false);
    const event = database.prepare(
      "SELECT event_type FROM audit_events WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1",
    ).get(rule.id) as { event_type: string };
    assert.equal(event.event_type, "permission.rule.removed");
  });
});

test("approval history includes pending, reviewed, and consumed states", async () => {
  await withServices(async ({ rules, approvals, guard }) => {
    rules.setRule({
      actorId: "agent:marketing", tool: "social", action: "publish",
      targetPattern: "account:brand", effect: "approval_required",
    });
    const pending = approvals.request(sensitiveAction);
    assert.equal(approvals.listAll().some((item) => item.id === pending.id && item.status === "pending"), true);
    approvals.approve(pending.id, "owner");
    assert.equal(approvals.listAll().some((item) => item.id === pending.id && item.status === "approved"), true);
    await guard.execute(sensitiveAction, () => "published", pending.id);
    assert.equal(approvals.listAll().some((item) => item.id === pending.id && item.status === "consumed"), true);
  });
});

test("workspace_assist allows workspace reads, gates changes, and denies other tools", async () => {
  await withServices(({ rules }) => {
    const policy = new PolicyEngine(rules, "workspace_assist");
    const request = (tool: string, action: string, actorId = "user:local") => ({ actorId, tool, action, target: "notes/example.txt", payload: {} });
    assert.equal(policy.evaluate(request("filesystem", "read")).effect, "allow");
    assert.equal(policy.evaluate(request("filesystem", "list")).effect, "allow");
    assert.equal(policy.evaluate(request("filesystem", "write")).effect, "approval_required");
    assert.equal(policy.evaluate(request("filesystem", "mkdir")).effect, "approval_required");
    assert.equal(policy.evaluate(request("terminal", "run")).effect, "approval_required");
    assert.equal(policy.evaluate(request("filesystem", "read", "agent:developer")).effect, "deny");
  });
});

test("workspace_assist routes write actions through exact approval", async () => {
  await withServices(async ({ rules, database }) => {
    const policy = new PolicyEngine(rules, "workspace_assist");
    const approvals = new ApprovalService(database, policy);
    const guard = new ExecutionGuard(database, policy, approvals);
    const action: ActionRequest = {
      actorId: "user:local", tool: "filesystem", action: "write",
      target: "notes/approved.txt", payload: { content: "approved workspace write" },
    };
    let executed = false;
    await assert.rejects(guard.execute(action, () => { executed = true; }), ApprovalRequiredError);
    assert.equal(executed, false);
    const pending = approvals.request(action);
    assert.equal(pending.status, "pending");
    approvals.approve(pending.id, "user:local");
    const result = await guard.execute(action, () => { executed = true; return "written"; }, pending.id);
    assert.equal(result, "written");
    assert.equal(executed, true);
    assert.equal(approvals.getById(pending.id)?.status, "consumed");
  });
});

test("terminal and browser actions cannot bypass explicit approval with an allow rule", async () => {
  await withServices(({ rules, policy }) => {
    rules.setRule({ actorId: "user:local", tool: "terminal", action: "run", effect: "allow" });
    assert.equal(policy.evaluate({
      actorId: "user:local", tool: "terminal", action: "run", target: ".",
      payload: { executable: "node", args: ["--version"], timeoutMs: 5000 },
    }).effect, "approval_required");

    rules.setRule({ actorId: "user:local", tool: "browser", action: "open", effect: "allow" });
    assert.equal(policy.evaluate({
      actorId: "user:local", tool: "browser", action: "open", target: "https://example.com",
    }).effect, "approval_required");

    rules.setRule({ actorId: "user:local", tool: "browser", action: "open", effect: "deny" });
    assert.equal(policy.evaluate({
      actorId: "user:local", tool: "browser", action: "open", target: "https://example.com",
    }).effect, "deny");
  });
});

test("Windows computer actions always require exact approval even when an allow rule exists", async () => {
  await withServices(({ rules, policy }) => {
    rules.setRule({ actorId: "user:local", tool: "computer", action: "invoke", effect: "allow" });
    assert.equal(policy.evaluate({
      actorId: "user:local", tool: "computer", action: "invoke",
      target: "Untitled - Notepad", payload: { automationId: "ButtonSave" },
    }).effect, "approval_required");
    rules.setRule({ actorId: "user:local", tool: "computer", action: "invoke", effect: "deny" });
    assert.equal(policy.evaluate({
      actorId: "user:local", tool: "computer", action: "invoke",
      target: "Untitled - Notepad", payload: { automationId: "ButtonSave" },
    }).effect, "deny");
  });
});

test("MCP external tool calls always require exact approval even with an allow rule", async () => {
  await withServices(({ rules, policy }) => {
    rules.setRule({ actorId: "user:local", tool: "mcp", action: "call", effect: "allow" });
    assert.equal(policy.evaluate({
      actorId: "user:local", tool: "mcp", action: "call",
      target: "github/create_issue",
      payload: { arguments: { title: "Approved issue" }, serverFingerprint: "a".repeat(64) },
    }).effect, "approval_required");
  });
});

test("an explicit deny rule overrides the terminal and browser approval requirement", async () => {
  await withServices(({ rules }) => {
    rules.setRule({ actorId: "user:local", tool: "terminal", action: "run", effect: "deny" });
    const policy = new PolicyEngine(rules, "workspace_assist");
    assert.equal(policy.evaluate({ actorId: "user:local", tool: "terminal", action: "run", target: ".", payload: {} }).effect, "deny");
    assert.equal(policy.evaluate({ actorId: "user:local", tool: "browser", action: "open", target: "https://example.com", payload: {} }).effect, "approval_required");
  });
});

test("workspace_autonomy allows workspace filesystem actions but keeps sensitive tools approval-gated", async () => {
  const homeDir = mkdtempSync(join(tmpdir(), "scopy-autonomy-test-"));
  const database = openDatabase(loadConfig(homeDir));
  try {
    const rules = new PermissionRepository(database);
    const policy = new PolicyEngine(rules, "workspace_autonomy");
    for (const action of ["read", "list", "write", "mkdir"]) {
      const decision = policy.evaluate({ actorId: "user:local", tool: "filesystem", action, target: ".", payload: {} });
      assert.equal(decision.effect, "allow", `workspace_autonomy should allow filesystem ${action}`);
    }
    for (const [tool, action] of [["terminal", "run"], ["browser", "open"], ["computer", "screenshot"], ["mcp", "call"]] as Array<[string, string]>) {
      const decision = policy.evaluate({ actorId: "user:local", tool, action, target: ".", payload: {} });
      assert.equal(decision.effect, "approval_required", `${tool} ${action} must stay approval-gated under workspace_autonomy`);
    }
    const denied = policy.evaluate({ actorId: "user:local", tool: "social", action: "publish", target: "account:brand", payload: {} });
    assert.equal(denied.effect, "deny", "non-workspace tools without a rule stay default-denied");
  } finally {
    database.close();
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("explicit rules still win over the workspace_autonomy profile", async () => {
  const homeDir = mkdtempSync(join(tmpdir(), "scopy-autonomy-rules-test-"));
  const database = openDatabase(loadConfig(homeDir));
  try {
    const rules = new PermissionRepository(database);
    rules.setRule({ actorId: "user:local", tool: "filesystem", action: "write", effect: "deny" });
    const policy = new PolicyEngine(rules, "workspace_autonomy");
    const decision = policy.evaluate({ actorId: "user:local", tool: "filesystem", action: "write", target: ".", payload: {} });
    assert.equal(decision.effect, "deny", "an explicit deny rule must override the autonomy profile");
    rules.setRule({ actorId: "user:local", tool: "filesystem", action: "write", effect: "approval_required" });
    const gated = policy.evaluate({ actorId: "user:local", tool: "filesystem", action: "write", target: ".", payload: {} });
    assert.equal(gated.effect, "approval_required", "an explicit approval rule must override the autonomy profile");
  } finally {
    database.close();
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("strict profile remains the default and denies workspace writes without a rule", async () => {
  const homeDir = mkdtempSync(join(tmpdir(), "scopy-strict-default-test-"));
  const database = openDatabase(loadConfig(homeDir));
  try {
    assert.equal(loadConfig(homeDir).safetyProfile, "strict");
    const policy = new PolicyEngine(new PermissionRepository(database));
    const decision = policy.evaluate({ actorId: "user:local", tool: "filesystem", action: "write", target: ".", payload: {} });
    assert.equal(decision.effect, "deny", "strict default must keep denying workspace writes without a rule");
  } finally {
    database.close();
    rmSync(homeDir, { recursive: true, force: true });
  }
});
