import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { ApprovalService } from "../src/permissions/approval-service.js";
import { ApprovalRequiredError, ExecutionGuard, PermissionDeniedError } from "../src/permissions/execution-guard.js";
import { PermissionRepository } from "../src/permissions/permission-repository.js";
import { PolicyEngine } from "../src/permissions/policy-engine.js";
import { FilesystemSandboxError, FilesystemTool } from "../src/tools/filesystem-tool.js";
import { TerminalTool } from "../src/tools/terminal-tool.js";
import { ToolGateway } from "../src/tools/tool-gateway.js";

async function withGateway(run: (context: {
  home: string;
  workspace: string;
  outside: string;
  gateway: ToolGateway;
  rules: PermissionRepository;
  approvals: ApprovalService;
}) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "scopy-gateway-test-"));
  const workspace = join(home, "workspace");
  const outside = join(home, "outside");
  const database = openDatabase(loadConfig(home));
  const rules = new PermissionRepository(database);
  const policy = new PolicyEngine(rules);
  const approvals = new ApprovalService(database, policy);
  const guard = new ExecutionGuard(database, policy, approvals);
  const gateway = new ToolGateway(guard);
  const filesystem = new FilesystemTool({ workspaceRoot: workspace });
  filesystem.register(gateway);
  try {
    await run({ home, workspace, outside, gateway, rules, approvals });
  } finally {
    database.close();
    rmSync(home, { recursive: true, force: true });
  }
}

test("tool gateway enforces default deny before calling a registered tool", async () => {
  await withGateway(async ({ gateway }) => {
    await assert.rejects(
      gateway.execute({
        actorId: "agent:developer", tool: "filesystem", action: "write",
        target: "notes.txt", payload: { content: "blocked" },
      }),
      PermissionDeniedError,
    );
  });
});

test("filesystem tool reads and writes only inside the workspace", async () => {
  await withGateway(async ({ gateway, rules, workspace }) => {
    rules.setRule({
      actorId: "agent:developer", tool: "filesystem", action: "write",
      targetPattern: "*", effect: "allow",
    });
    rules.setRule({
      actorId: "agent:developer", tool: "filesystem", action: "read",
      targetPattern: "*", effect: "allow",
    });

    const file = join(workspace, "notes", "hello.txt");
    const written = await gateway.execute<{ bytesWritten: number }>({
      actorId: "agent:developer", tool: "filesystem", action: "write",
      target: file, payload: { content: "Scopy workspace" },
    });
    assert.equal(written.bytesWritten, Buffer.byteLength("Scopy workspace"));

    const content = await gateway.execute<string>({
      actorId: "agent:developer", tool: "filesystem", action: "read", target: file,
    });
    assert.equal(content, "Scopy workspace");
    assert.equal(await readFile(file, "utf8"), "Scopy workspace");
  });
});

test("filesystem tool blocks paths outside the workspace", async () => {
  await withGateway(async ({ gateway, rules, outside }) => {
    rules.setRule({
      actorId: "agent:developer", tool: "filesystem", action: "write",
      targetPattern: "*", effect: "allow",
    });
    await assert.rejects(
      gateway.execute({
        actorId: "agent:developer", tool: "filesystem", action: "write",
        target: join(outside, "blocked.txt"), payload: { content: "no" },
      }),
      FilesystemSandboxError,
    );
  });
});

test("filesystem tool blocks a symlink that points outside the workspace", async () => {
  await withGateway(async ({ gateway, rules, workspace, outside }) => {
    rules.setRule({
      actorId: "agent:developer", tool: "filesystem", action: "write",
      targetPattern: "*", effect: "allow",
    });
    // A junction requires both its target and its parent directory to exist.
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });
    const link = join(workspace, "outside-link");
    await symlink(outside, link, "junction");
    await assert.rejects(
      gateway.execute({
        actorId: "agent:developer", tool: "filesystem", action: "write",
        target: join(link, "escape.txt"), payload: { content: "no" },
      }),
      FilesystemSandboxError,
    );
  });
});

test("gateway rejects duplicate tool registrations", async () => {
  await withGateway(async ({ gateway }) => {
    assert.throws(() => gateway.register("filesystem", "duplicate", () => "bad"));
  });
});

test("tool gateway requires and consumes approval before sensitive tool execution", async () => {
  await withGateway(async ({ gateway, rules, approvals }) => {
    rules.setRule({
      actorId: "agent:operations", tool: "filesystem", action: "write",
      targetPattern: "*", effect: "approval_required",
    });
    const request = {
      actorId: "agent:operations",
      tool: "filesystem",
      action: "write",
      target: "approved.txt",
      payload: { content: "approved" },
    };
    await assert.rejects(gateway.execute(request), ApprovalRequiredError);

    const pending = approvals.request(request);
    approvals.approve(pending.id, "local-owner");
    const result = await gateway.execute<{ bytesWritten: number }>(request, pending.id);
    assert.equal(result.bytesWritten, Buffer.byteLength("approved"));
    assert.equal(approvals.getById(pending.id)?.status, "consumed");
  });
});


test("filesystem tool lists workspace entries and creates directories only through policy", async () => {
  await withGateway(async ({ gateway, rules, approvals }) => {
    rules.setRule({
      actorId: "agent:developer", tool: "filesystem", action: "list",
      targetPattern: "*", effect: "allow",
    });
    rules.setRule({
      actorId: "agent:developer", tool: "filesystem", action: "mkdir",
      targetPattern: "*", effect: "approval_required",
    });
    await assert.rejects(
      gateway.execute({
        actorId: "agent:developer", tool: "filesystem", action: "mkdir", target: "notes",
      }),
      ApprovalRequiredError,
    );
    const request = {
      actorId: "agent:developer", tool: "filesystem", action: "mkdir",
      target: "notes", payload: {},
    };
    const pending = approvals.request(request);
    approvals.approve(pending.id, "local-owner");
    const created = await gateway.execute<{ created: boolean }>(request, pending.id);
    assert.equal(created.created, true);
    const listing = await gateway.execute<{ entries: Array<{ name: string; type: string }>; truncated: boolean }>({
      actorId: "agent:developer", tool: "filesystem", action: "list", target: ".",
    });
    assert.deepEqual(listing.entries, [{ name: "notes", type: "directory" }]);
    assert.equal(listing.truncated, false);
    await assert.rejects(
      gateway.execute({
        actorId: "agent:developer", tool: "filesystem", action: "list", target: "../",
      }),
      FilesystemSandboxError,
    );
  });
});


test("filesystem tool enforces a 1 MiB bound on file reads and writes", async () => {
  await withGateway(async ({ gateway, rules, workspace }) => {
    rules.setRule({
      actorId: "agent:developer", tool: "filesystem", action: "read",
      targetPattern: "*", effect: "allow",
    });
    rules.setRule({
      actorId: "agent:developer", tool: "filesystem", action: "write",
      targetPattern: "*", effect: "allow",
    });
    await writeFile(join(workspace, "large.txt"), "x".repeat(1_048_577), "utf8");
    await assert.rejects(
      gateway.execute({
        actorId: "agent:developer", tool: "filesystem", action: "read", target: "large.txt",
      }),
      /1 MiB read limit/,
    );
    await assert.rejects(
      gateway.execute({
        actorId: "agent:developer", tool: "filesystem", action: "write",
        target: "too-large.txt", payload: { content: "x".repeat(1_048_577) },
      }),
      /cannot exceed 1 MiB/,
    );
  });
});


test("terminal adapter executes an exact approved command without a shell", async () => {
  await withGateway(async ({ gateway, workspace, approvals }) => {
    await mkdir(workspace, { recursive: true });
    new TerminalTool(workspace).register(gateway);
    const request = {
      actorId: "user:local",
      tool: "terminal",
      action: "run",
      target: ".",
      payload: { executable: "node", args: ["-e", "process.stdout.write('scopy-terminal-ok')"], timeoutMs: 10000 },
    };
    await assert.rejects(gateway.execute(request), ApprovalRequiredError);
    const approval = approvals.request(request);
    approvals.approve(approval.id, "user:local");
    const result = await gateway.execute<{
      exitCode: number | null; stdout: string; stderr: string;
    }>(request, approval.id);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "scopy-terminal-ok");
    assert.equal(approvals.getById(approval.id)?.status, "consumed");
  });
});

test("terminal adapter rejects working directories outside its workspace", async () => {
  await withGateway(async ({ gateway, workspace, outside, approvals }) => {
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });
    new TerminalTool(workspace).register(gateway);
    const request = {
      actorId: "user:local",
      tool: "terminal",
      action: "run",
      target: outside,
      payload: { executable: "node", args: ["--version"], timeoutMs: 5000 },
    };
    const approval = approvals.request(request);
    approvals.approve(approval.id, "user:local");
    await assert.rejects(gateway.execute(request, approval.id), /outside the configured Scopy workspace/);
  });
});
