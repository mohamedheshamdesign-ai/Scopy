import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { ScopyConfig } from "../config.js";
import type { ScopyDatabase } from "../db/database.js";
import { createLocalAiRouter } from "../ai/create-local-router.js";
import { AgentRegistry, buildAgentMessages } from "../agents/agent-registry.js";
import { loadProjectContext } from "../project/project-context.js";
import { TaskRepository, type TaskPriority, type TaskStatus } from "../tasks/task-repository.js";
import { ProjectRepository } from "../projects/project-repository.js";
import { MemoryRepository, type MemoryType } from "../memory/memory-repository.js";
import { PlanRepository } from "../orchestrator/plan-repository.js";
import { PlanRunRepository } from "../orchestrator/run-repository.js";
import { generateDraftPlan } from "../orchestrator/planner.js";
import { PermissionRepository } from "../permissions/permission-repository.js";
import { PolicyEngine } from "../permissions/policy-engine.js";
import { ApprovalService } from "../permissions/approval-service.js";
import { ExecutionGuard } from "../permissions/execution-guard.js";
import { RuntimeEngine } from "../runtime/runtime-engine.js";
import { ToolGateway } from "../tools/tool-gateway.js";
import { FilesystemTool } from "../tools/filesystem-tool.js";
import { TerminalTool } from "../tools/terminal-tool.js";
import { PlanStepExecutor } from "../orchestrator/step-executor.js";
import { BackupService } from "../backup/backup-service.js";
import { dashboardHtml } from "./dashboard-html.js";

const MAX_BODY_BYTES = 64 * 1024;
const ACTOR = "user:local";

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected Scopy error.";
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body exceeds the 64 KiB limit.");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function stringField(input: Record<string, unknown>, name: string, max: number): string {
  const value = input[name];
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(name + " must be a non-empty string of at most " + max + " characters.");
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, name: string, max: number): string | undefined {
  const value = input[name];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max) throw new Error(name + " must be a string of at most " + max + " characters.");
  return value.trim();
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface DashboardOptions {
  readonly port?: number;
}

export class DashboardServer {
  private server: Server | undefined;
  private token = "";
  private boundPort = 4173;

  constructor(
    private readonly config: ScopyConfig,
    private readonly database: ScopyDatabase,
    private readonly options: DashboardOptions = {},
  ) {}

  async start(): Promise<void> {
    const port = this.options.port ?? Number(process.env.SCOPY_DASHBOARD_PORT ?? "4173");
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Dashboard port must be between 1024 and 65535.");
    this.boundPort = port;
    const secrets = join(this.config.homeDir, "secrets");
    await mkdir(secrets, { recursive: true });
    const tokenPath = join(secrets, "dashboard-token.txt");
    try {
      this.token = (await readFile(tokenPath, "utf8")).trim();
    } catch {
      this.token = randomBytes(32).toString("hex");
      await writeFile(tokenPath, this.token + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
      await chmod(tokenPath, 0o600).catch(() => undefined);
    }
    if (!/^[a-f0-9]{64}$/.test(this.token)) throw new Error("Dashboard token file is invalid. Preserve it and inspect the file before replacing it.");

    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        json(response, error instanceof SyntaxError ? 400 : 400, { error: errorMessage(error) });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
    console.log("");
    console.log("Scopy local workspace is running.");
    console.log("Open: http://127.0.0.1:" + this.boundPort + "/#token=" + this.token);
    console.log("Bound to 127.0.0.1 only. Keep this terminal open; press Ctrl+C to stop.");
    console.log("Dashboard token is stored under SCOPY_HOME\\secrets\\dashboard-token.txt.");
    await new Promise<void>((resolve) => {
      this.server!.once("close", resolve);
    });
  }

  close(): void {
    this.server?.close();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const host = request.headers.host ?? "";
    if (host !== "127.0.0.1:" + this.boundPort && host !== "localhost:" + this.boundPort) {
      json(response, 403, { error: "Invalid Host header." });
      return;
    }
    const origin = request.headers.origin;
    if (origin && origin !== "http://" + host) {
      json(response, 403, { error: "Cross-origin requests are not allowed." });
      return;
    }
    const url = new URL(request.url ?? "/", "http://" + host);
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(dashboardHtml);
      return;
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      json(response, 200, { status: "ok", app: "Scopy", localOnly: true });
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      json(response, 404, { error: "Not found." });
      return;
    }
    const authorization = request.headers.authorization ?? "";
    if (!authorization.startsWith("Bearer ") || !safeEqual(authorization.slice(7), this.token)) {
      json(response, 401, { error: "Dashboard authorization required." });
      return;
    }
    await this.routeApi(request, response, url);
  }

  private async routeApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const method = request.method ?? "GET";
    const path = url.pathname;
    const tasks = new TaskRepository(this.database);
    const projects = new ProjectRepository(this.database);
    const memories = new MemoryRepository(this.database);
    const plans = new PlanRepository(this.database);
    const runs = new PlanRunRepository(this.database);
    const permissions = new PermissionRepository(this.database);
    const policy = new PolicyEngine(permissions, this.config.safetyProfile);
    const approvals = new ApprovalService(this.database, policy);

    if (method === "GET" && path === "/api/state") {
      const counts = {
        tasks: (this.database.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status != 'completed'").get() as { n: number }).n,
        projects: (this.database.prepare("SELECT COUNT(*) AS n FROM projects WHERE status = 'active'").get() as { n: number }).n,
        memories: (this.database.prepare("SELECT COUNT(*) AS n FROM memory_records WHERE status = 'active'").get() as { n: number }).n,
        pendingApprovals: (this.database.prepare("SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'pending'").get() as { n: number }).n,
        running: (this.database.prepare("SELECT COUNT(*) AS n FROM orchestrator_runs WHERE status = 'running'").get() as { n: number }).n,
      };
      const audit = this.database.prepare("SELECT id, event_type AS eventType, entity_type AS entityType, entity_id AS entityId, created_at AS createdAt FROM audit_events ORDER BY created_at DESC LIMIT 30").all();
      let ai: Record<string, unknown> = { configured: false, healthy: false, detail: "Local model is not configured in this PowerShell session." };
      if (process.env.SCOPY_LOCAL_AI_MODEL?.trim()) {
        try {
          const router = createLocalAiRouter(this.database);
          const provider = router.list()[0];
          ai = provider ? { configured: true, ...(await router.health(provider.id)) } : { configured: false, healthy: false };
        } catch (error) {
          ai = { configured: true, healthy: false, detail: errorMessage(error) };
        }
      }
      json(response, 200, {
        counts,
        ai,
        agents: new AgentRegistry().list().map(({ systemPrompt, ...agent }) => agent),
        tasks: tasks.list({ limit: 100 }),
        projects: projects.list({ limit: 100 }),
        memories: memories.list({ limit: 100 }),
        plans: plans.list(50),
        runs: runs.list(50),
        approvals: approvals.listAll(100),
        permissions: permissions.list(),
        audit,
        workspace: this.config.workspaceDir,
        safetyProfile: this.config.safetyProfile,
      });
      return;
    }

    if (method === "POST" && path === "/api/chat") {
      const input = await body(request);
      const prompt = stringField(input, "prompt", 8000);
      const agentId = optionalString(input, "agentId", 40) ?? "assistant";
      const profile = new AgentRegistry().get(agentId);
      const router = createLocalAiRouter(this.database);
      const provider = router.list()[0];
      if (!provider) throw new Error("No local AI provider is configured.");
      const projectContext = await loadProjectContext();
      const relevant = memories.search(prompt, { limit: 5 });
      const result = await router.generate(provider.id, {
        messages: buildAgentMessages(profile, prompt, projectContext, relevant),
        temperature: 0.2,
        maxOutputTokens: 1800,
      }, { actorId: ACTOR, purpose: "local dashboard chat: " + agentId });
      json(response, 200, { text: result.text, model: result.model, durationMs: result.durationMs, agentId });
      return;
    }

    if (method === "POST" && path === "/api/tasks") {
      const input = await body(request);
      const priority = input.priority ?? "normal";
      if (priority !== "low" && priority !== "normal" && priority !== "high" && priority !== "urgent") throw new Error("Invalid task priority.");
      const description = optionalString(input, "description", 4000);
      const projectId = optionalString(input, "projectId", 36);
      json(response, 201, tasks.create({
        title: stringField(input, "title", 200),
        priority: priority as TaskPriority,
        ...(description === undefined ? {} : { description }),
        ...(projectId === undefined ? {} : { projectId }),
      }));
      return;
    }

    const taskMatch = path.match(/^\/api\/tasks\/([0-9a-f-]{36})$/i);
    if (taskMatch && method === "PATCH") {
      const input = await body(request);
      const status = input.status;
      const priority = input.priority;
      if (status !== undefined && status !== "open" && status !== "in_progress" && status !== "completed" && status !== "cancelled") throw new Error("Invalid task status.");
      if (priority !== undefined && priority !== "low" && priority !== "normal" && priority !== "high" && priority !== "urgent") throw new Error("Invalid task priority.");
      const title = input.title === undefined ? undefined : stringField(input, "title", 200);
      const description = input.description === undefined ? undefined : stringField(input, "description", 4000);
      json(response, 200, tasks.update(taskMatch[1]!, {
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
        ...(status === undefined ? {} : { status: status as TaskStatus }),
        ...(priority === undefined ? {} : { priority: priority as TaskPriority }),
      }));
      return;
    }

    if (method === "POST" && path === "/api/projects") {
      const input = await body(request);
      const description = optionalString(input, "description", 4000);
      json(response, 201, projects.create({
        name: stringField(input, "name", 120),
        ...(description === undefined ? {} : { description }),
      }));
      return;
    }

    if (method === "POST" && path === "/api/memories") {
      const input = await body(request);
      const type = input.type;
      const allowed: MemoryType[] = ["working", "episodic", "semantic", "project", "preference", "procedural"];
      if (typeof type !== "string" || !allowed.includes(type as MemoryType)) throw new Error("Invalid memory type.");
      const scope = optionalString(input, "scope", 200) ?? "global";
      json(response, 201, memories.create({
        type: type as MemoryType,
        scope,
        content: stringField(input, "content", 20000),
        sourceType: "user_confirmed",
        sourceRef: "dashboard",
        confidence: 1,
      }));
      return;
    }

    const memoryArchive = path.match(/^\/api\/memories\/([0-9a-f-]{36})\/archive$/i);
    if (memoryArchive && method === "POST") {
      json(response, 200, { archived: memories.archive(memoryArchive[1]!) });
      return;
    }

    if (method === "POST" && path === "/api/plans") {
      const input = await body(request);
      const goal = stringField(input, "goal", 2000);
      const router = createLocalAiRouter(this.database);
      const provider = router.list()[0];
      if (!provider) throw new Error("No local AI provider is configured.");
      json(response, 201, await generateDraftPlan(router, provider.id, plans, goal));
      return;
    }

    const planReview = path.match(/^\/api\/plans\/([0-9a-f-]{36})\/review$/i);
    if (planReview && method === "POST") {
      const input = await body(request);
      if (input.decision !== "approved" && input.decision !== "rejected") throw new Error("Review decision must be approved or rejected.");
      json(response, 200, plans.review(planReview[1]!, input.decision, ACTOR));
      return;
    }

    if (method === "POST" && path === "/api/runs") {
      const input = await body(request);
      const planId = stringField(input, "planId", 36);
      json(response, 201, runs.start(planId, ACTOR));
      return;
    }

    const runExecute = path.match(/^\/api\/runs\/([0-9a-f-]{36})\/execute$/i);
    if (runExecute && method === "POST") {
      const input = await body(request);
      const gateway = new ToolGateway(new ExecutionGuard(this.database, policy, approvals));
      new FilesystemTool({ workspaceRoot: this.config.workspaceDir }).register(gateway);
      new TerminalTool(this.config.workspaceDir).register(gateway);
      const runtime = new RuntimeEngine(this.database, gateway);
      const executor = new PlanStepExecutor(runs, policy, approvals, runtime);
      const result = await executor.executeReadySteps(runExecute[1]!, {}, optionalString(input, "approvalId", 36));
      json(response, 200, result);
      return;
    }

    const approvalReview = path.match(/^\/api\/approvals\/([0-9a-f-]{36})\/review$/i);
    if (approvalReview && method === "POST") {
      const input = await body(request);
      if (input.decision === "approved") json(response, 200, approvals.approve(approvalReview[1]!, ACTOR));
      else if (input.decision === "rejected") json(response, 200, approvals.reject(approvalReview[1]!, ACTOR));
      else throw new Error("Review decision must be approved or rejected.");
      return;
    }

    if (method === "POST" && path === "/api/permissions") {
      const input = await body(request);
      const effect = input.effect;
      if (effect !== "allow" && effect !== "deny" && effect !== "approval_required") throw new Error("Invalid permission effect.");
      json(response, 201, permissions.setRule({
        actorId: stringField(input, "actorId", 120),
        tool: stringField(input, "tool", 80),
        action: stringField(input, "action", 80),
        targetPattern: optionalString(input, "targetPattern", 500) ?? "*",
        effect,
      }));
      return;
    }

    const permissionDelete = path.match(/^\/api\/permissions\/([0-9a-f-]{36})$/i);
    if (permissionDelete && method === "DELETE") {
      json(response, 200, { removed: permissions.removeRule(permissionDelete[1]!) });
      return;
    }


    if (method === "POST" && path === "/api/terminal/requests") {
      const input = await body(request);
      const executable = stringField(input, "executable", 32);
      if (!Array.isArray(input.args) || input.args.length > 100 ||
          !input.args.every((arg) => typeof arg === "string" && arg.length <= 4096)) {
        throw new Error("Terminal args must be an array of at most 100 strings.");
      }
      const workingDirectory = optionalString(input, "workingDirectory", 500) ?? ".";
      const timeoutMs = input.timeoutMs ?? 30000;
      if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
        throw new Error("Terminal timeout must be between 1000 and 120000 milliseconds.");
      }
      const action = {
        actorId: ACTOR,
        tool: "terminal",
        action: "run",
        target: workingDirectory,
        payload: { executable, args: input.args as string[], timeoutMs },
      };
      json(response, 201, approvals.request(action));
      return;
    }

    if (method === "POST" && path === "/api/terminal/execute") {
      const input = await body(request);
      const executable = stringField(input, "executable", 32);
      if (!Array.isArray(input.args) || input.args.length > 100 ||
          !input.args.every((arg) => typeof arg === "string" && arg.length <= 4096)) {
        throw new Error("Terminal args must be an array of at most 100 strings.");
      }
      const workingDirectory = optionalString(input, "workingDirectory", 500) ?? ".";
      const timeoutMs = input.timeoutMs ?? 30000;
      if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
        throw new Error("Terminal timeout must be between 1000 and 120000 milliseconds.");
      }
      const approvalId = stringField(input, "approvalId", 36);
      const action = {
        actorId: ACTOR,
        tool: "terminal",
        action: "run",
        target: workingDirectory,
        payload: { executable, args: input.args as string[], timeoutMs },
      };
      const gateway = new ToolGateway(new ExecutionGuard(this.database, policy, approvals));
      new TerminalTool(this.config.workspaceDir).register(gateway);
      const runtime = new RuntimeEngine(this.database, gateway);
      const result = await runtime.execute(action, { timeoutMs: timeoutMs + 5000, maxOutputBytes: 65536 }, approvalId);
      json(response, 200, result);
      return;
    }

    if (method === "POST" && path === "/api/backups") {
      json(response, 201, await new BackupService(this.database, this.config.homeDir).create());
      return;
    }

    json(response, 404, { error: "Unknown dashboard API route." });
  }
}
