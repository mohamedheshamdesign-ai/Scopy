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
import { BrowserTool } from "../tools/browser-tool.js";
import { McpServerManager } from "../integrations/mcp/mcp-server-manager.js";
import { McpTool } from "../tools/mcp-tool.js";
import { WindowsComputerTool } from "../tools/windows-computer-tool.js";
import { PlanStepExecutor } from "../orchestrator/step-executor.js";
import { BackupService } from "../backup/backup-service.js";
import { LocalBrowserSession } from "../browser/browser-session.js";
import { dashboardHtml } from "./dashboard-html.js";
import { searchWeb } from "../research/web-research.js";

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
  private readonly browser: LocalBrowserSession;
  private readonly mcp: McpServerManager;

  constructor(
    private readonly config: ScopyConfig,
    private readonly database: ScopyDatabase,
    private readonly options: DashboardOptions = {},
  ) {
    this.browser = new LocalBrowserSession(config.homeDir);
    this.mcp = new McpServerManager(config.homeDir);
  }

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
    const shutdown = (): void => { void this.browser.close().finally(() => this.server?.close()); };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    await new Promise<void>((resolve) => {
      this.server!.once("close", resolve);
    });
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  }

  close(): void {
    void this.browser.close();
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

    if (request.method === "GET" && url.pathname === "/manifest.webmanifest") {
      response.writeHead(200, { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-cache" });
      response.end(JSON.stringify({
        name: "Scopy Local Workspace",
        short_name: "Scopy",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#07111f",
        theme_color: "#07111f",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/icon.svg") {
      response.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2563eb"/><stop offset="1" stop-color="#5dd6e8"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="#07111f"/><path d="M345 145c-26-25-58-38-98-38-83 0-143 61-143 148s60 148 146 148c43 0 79-14 107-42v-99H247v57h43v14c-10 8-22 12-39 12-47 0-77-35-77-90s30-90 75-90c22 0 40 8 55 23z" fill="url(#g)"/></svg>');
      return;
    }
    if (request.method === "GET" && url.pathname === "/sw.js") {
      response.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/" });
      response.end("const CACHE='scopy-shell-v1';const SHELL=['/','/manifest.webmanifest','/icon.svg'];self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))));});");
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(dashboardHtml);
      return;
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      json(response, 200, { status: "ok", app: "Scopy", localOnly: true });
      return;
    }

    if (url.pathname === "/api/session" && request.method === "POST") {
      const authorization = request.headers.authorization ?? "";
      if (!authorization.startsWith("Bearer ") || !safeEqual(authorization.slice(7), this.token)) {
        json(response, 401, { error: "Dashboard token is invalid." });
        return;
      }
      response.writeHead(204, {
        "set-cookie": "scopy_session=" + this.token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400",
        "cache-control": "no-store",
      });
      response.end();
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      json(response, 404, { error: "Not found." });
      return;
    }
    const authorization = request.headers.authorization ?? "";
    const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const cookie = (request.headers.cookie ?? "").split(";").map((part) => part.trim())
      .find((part) => part.startsWith("scopy_session="))?.slice("scopy_session=".length) ?? "";
    if (!safeEqual(bearer || cookie, this.token)) {
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

    if (method === "POST" && path === "/api/research") {
      const input = await body(request);
      const query = stringField(input, "query", 400);
      json(response, 200, await searchWeb(query, 8));
      return;
    }

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
        mcpServers: await this.mcp.list(),
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
      new BrowserTool(this.config.homeDir).register(gateway);
      new McpTool(this.mcp).register(gateway);
      new WindowsComputerTool().register(gateway);
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
      const result = await runtime.execute(action, { timeoutMs: timeoutMs + 5000, maxOutputBytes: 100000 }, approvalId);
      json(response, 200, result);
      return;
    }


    if (method === "GET" && path === "/api/browser/status") {
      json(response, 200, this.browser.status());
      return;
    }

    if (method === "POST" && path === "/api/browser/start") {
      json(response, 200, await this.browser.start());
      return;
    }

    if (method === "POST" && path === "/api/browser/requests") {
      const input = await body(request);
      const action = stringField(input, "browserAction", 20);
      if (!["click", "type", "keypress"].includes(action)) throw new Error("Browser action must be click, type, or keypress.");
      const target = this.browser.status().activeUrl;
      if (!target) throw new Error("Open a browser page before requesting an interaction.");
      let payload: Record<string, unknown>;
      if (action === "click") payload = { selector: stringField(input, "selector", 500) };
      else if (action === "type") payload = { selector: stringField(input, "selector", 500), text: stringField(input, "text", 5000) };
      else payload = { key: stringField(input, "key", 20) };
      const matchingRule = permissions.findMatching(ACTOR, "browser", action, target);
      if (!matchingRule) permissions.setRule({ actorId: ACTOR, tool: "browser", action, targetPattern: target, effect: "approval_required" });
      else if (matchingRule.effect !== "approval_required") throw new Error("An existing browser permission rule does not require approval. Review it in Settings before proceeding.");
      json(response, 201, approvals.request({ actorId: ACTOR, tool: "browser", action, target, payload }));
      return;
    }

    if (method === "POST" && path === "/api/browser/execute") {
      const input = await body(request);
      const action = stringField(input, "browserAction", 20);
      const target = stringField(input, "target", 2048);
      const approvalId = stringField(input, "approvalId", 36);
      const payload = input.payload;
      if (!["click", "type", "keypress"].includes(action) || typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Error("A valid approved browser action and payload are required.");
      }
      const requestAction = { actorId: ACTOR, tool: "browser", action, target, payload: payload as Record<string, unknown> };
      const gateway = new ToolGateway(new ExecutionGuard(this.database, policy, approvals));
      new BrowserTool(this.browser).register(gateway);
      const runtime = new RuntimeEngine(this.database, gateway);
      const result = await runtime.execute(requestAction, { timeoutMs: 120000, maxOutputBytes: 100000 }, approvalId);
      json(response, 200, result);
      return;
    }

    if (method === "GET" && path === "/api/browser/screenshot") {
      json(response, 200, await this.browser.screenshot());
      return;
    }

    if (method === "POST" && path === "/api/browser/open") {
      const input = await body(request);
      const url = stringField(input, "url", 2048);
      json(response, 200, await this.browser.open(url));
      return;
    }

    if (method === "GET" && path === "/api/browser/read") {
      json(response, 200, await this.browser.read());
      return;
    }

    if (method === "POST" && path === "/api/browser/close") {
      await this.browser.close();
      json(response, 200, { closed: true });
      return;
    }

    if (method === "POST" && path === "/api/delegate") {
      const input = await body(request);
      const prompt = stringField(input, "prompt", 8000);
      if (!Array.isArray(input.agentIds) || input.agentIds.length < 2 || input.agentIds.length > 3 ||
          !input.agentIds.every((id) => typeof id === "string")) {
        throw new Error("Team mode requires two or three specialist agent IDs.");
      }
      const registry = new AgentRegistry();
      const selected = [...new Set(input.agentIds as string[])].map((id) => registry.get(id));
      if (selected.some((agent) => agent.id === "assistant")) throw new Error("Choose specialist profiles for team mode.");
      const router = createLocalAiRouter(this.database);
      const provider = router.list()[0];
      if (!provider) throw new Error("No local AI provider is configured.");
      const projectContext = await loadProjectContext();
      const relevant = memories.search(prompt, { limit: 5 });
      const contributions: Array<{ agentId: string; name: string; response: string }> = [];
      for (const agent of selected) {
        const result = await router.generate(provider.id, {
          messages: buildAgentMessages(agent, prompt, projectContext, relevant),
          temperature: 0.2,
          maxOutputTokens: 700,
        }, { actorId: ACTOR, purpose: "local sequential specialist delegation: " + agent.id });
        contributions.push({ agentId: agent.id, name: agent.name, response: result.text });
      }
      const synthesis = await router.generate(provider.id, {
        messages: [
          { role: "system", content: "Synthesize the specialist contributions into one practical answer. Separate agreement, disagreements, assumptions, and recommended next actions. Do not claim any specialist used tools or performed actions." },
          { role: "user", content: "USER GOAL:\n" + prompt + "\n\nSPECIALIST CONTRIBUTIONS:\n" + contributions.map((item) => item.name + ":\n" + item.response).join("\n\n") },
        ],
        temperature: 0.2,
        maxOutputTokens: 1200,
      }, { actorId: ACTOR, purpose: "synthesize specialist delegation" });
      json(response, 200, { contributions, synthesis: synthesis.text, model: synthesis.model });
      return;
    }


    if (method === "POST" && path === "/api/mcp/servers") {
      const input = await body(request);
      if (!Array.isArray(input.args) || !Array.isArray(input.passEnv)) throw new Error("MCP args and passEnv must be JSON arrays.");
      const server = await this.mcp.add({
        id: stringField(input, "id", 40),
        command: stringField(input, "command", 32),
        args: input.args,
        passEnv: input.passEnv,
        timeoutMs: input.timeoutMs ?? 30000,
      });
      json(response, 201, server);
      return;
    }

    const mcpServerMatch = path.match(/^\/api\/mcp\/servers\/([a-z][a-z0-9-]{1,39})$/);
    if (mcpServerMatch && method === "DELETE") {
      json(response, 200, { removed: await this.mcp.remove(mcpServerMatch[1]!) });
      return;
    }

    const mcpToolsMatch = path.match(/^\/api\/mcp\/servers\/([a-z][a-z0-9-]{1,39})\/tools$/);
    if (mcpToolsMatch && method === "POST") {
      json(response, 200, { tools: await this.mcp.listTools(mcpToolsMatch[1]!) });
      return;
    }

    if (method === "POST" && path === "/api/mcp/requests") {
      const input = await body(request);
      const serverId = stringField(input, "serverId", 40);
      const toolName = stringField(input, "toolName", 128);
      const args = input.arguments;
      if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error("MCP arguments must be a JSON object.");
      json(response, 201, approvals.request({
        actorId: ACTOR, tool: "mcp", action: "call", target: serverId + "/" + toolName,
        payload: { arguments: args as Record<string, unknown>, serverFingerprint: await this.mcp.getServerFingerprint(serverId) },
      }));
      return;
    }

    if (method === "POST" && path === "/api/mcp/execute") {
      const input = await body(request);
      const serverId = stringField(input, "serverId", 40);
      const toolName = stringField(input, "toolName", 128);
      const args = input.arguments;
      if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error("MCP arguments must be a JSON object.");
      const approvalId = stringField(input, "approvalId", 36);
      const action = {
        actorId: ACTOR, tool: "mcp", action: "call", target: serverId + "/" + toolName,
        payload: { arguments: args as Record<string, unknown>, serverFingerprint: stringField(input, "serverFingerprint", 64) },
      };
      const gateway = new ToolGateway(new ExecutionGuard(this.database, policy, approvals));
      new McpTool(this.mcp).register(gateway);
      const runtime = new RuntimeEngine(this.database, gateway);
      const result = await runtime.execute(action, { timeoutMs: 125000, maxOutputBytes: 1_048_576 }, approvalId);
      json(response, 200, result);
      return;
    }


    if (method === "POST" && path === "/api/computer/requests") {
      const input = await body(request);
      const action = stringField(input, "computerAction", 20);
      const windowTitle = stringField(input, "windowTitle", 200);
      let payload: Record<string, unknown>;
      if (action === "snapshot") {
        const limit = input.limit ?? 100;
        if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error("Snapshot limit must be between 1 and 300.");
        payload = { limit };
      } else if (action === "invoke" || action === "set_value") {
        const automationId = optionalString(input, "automationId", 256);
        const name = optionalString(input, "name", 256);
        if (Boolean(automationId) === Boolean(name)) throw new Error("Provide exactly one Automation ID or exact control name.");
        payload = automationId ? { automationId } : { name };
        if (action === "set_value") payload.value = stringField(input, "value", 10000);
      } else if (action === "screenshot") {
        payload = {};
      } else {
        throw new Error("Computer action must be snapshot, invoke, set_value, or screenshot.");
      }
      json(response, 201, approvals.request({
        actorId: ACTOR, tool: "computer", action, target: windowTitle, payload,
      }));
      return;
    }

    if (method === "POST" && path === "/api/computer/execute") {
      const input = await body(request);
      const action = stringField(input, "computerAction", 20);
      const windowTitle = stringField(input, "windowTitle", 200);
      const approvalId = stringField(input, "approvalId", 36);
      const payload = input.payload;
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("Computer payload is required.");
      const requestAction = { actorId: ACTOR, tool: "computer", action, target: windowTitle, payload: payload as Record<string, unknown> };
      const gateway = new ToolGateway(new ExecutionGuard(this.database, policy, approvals));
      new WindowsComputerTool().register(gateway);
      const runtime = new RuntimeEngine(this.database, gateway);
      const result = await runtime.execute(requestAction, { timeoutMs: 30000, maxOutputBytes: action === "screenshot" ? 1_048_576 : 65536 }, approvalId);
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
