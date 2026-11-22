import { AgentRegistry, buildAgentMessages } from "./agents/agent-registry.js";
import { ScopyLogger } from "./logging/scopy-logger.js";
import { runDoctor } from "./doctor/doctor.js";
import { createLocalAiRouter } from "./ai/create-local-router.js";
import { listLocalModels } from "./ai/local-openai-provider.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { loadProjectContext } from "./project/project-context.js";
import { MemoryRepository, type MemoryType } from "./memory/memory-repository.js";
import { generateDraftPlan } from "./orchestrator/planner.js";
import { PlanRepository } from "./orchestrator/plan-repository.js";
import { PlanRunRepository } from "./orchestrator/run-repository.js";
import { TaskNotFoundError, TaskRepository, type TaskPriority, type TaskStatus } from "./tasks/task-repository.js";
import { ProjectRepository } from "./projects/project-repository.js";
import { BackupService, restoreBackupSnapshot } from "./backup/backup-service.js";
import { AuditRepository } from "./audit/audit-repository.js";
import { ApprovalService } from "./permissions/approval-service.js";
import { ExecutionGuard } from "./permissions/execution-guard.js";
import { PermissionRepository } from "./permissions/permission-repository.js";
import { PolicyEngine } from "./permissions/policy-engine.js";
import { RuntimeEngine } from "./runtime/runtime-engine.js";
import { FilesystemTool } from "./tools/filesystem-tool.js";
import { ToolGateway } from "./tools/tool-gateway.js";
import { PlanStepExecutor } from "./orchestrator/step-executor.js";

function printUsage(): void {
  console.log(`
Scopy local core

Commands:
  npm run dev -- health
  npm run dev -- doctor
  npm run dev -- task add "Task title"
  npm run dev -- task list
  npm run dev -- task show <task-id>
  npm run dev -- task complete <task-id>
  npm run dev -- task update <task-id> <title|description|status|priority|project> <value>
  npm run dev -- project create "Project name" ["Description"]
  npm run dev -- project list [--all]
  npm run dev -- project show <project-id>
  npm run dev -- project update <project-id> <name|description> <value>
  npm run dev -- project archive <project-id>
  npm run dev -- backup create
  npm run dev -- backup list
  npm run dev -- backup verify <backup-filename>
  npm run dev -- backup restore <backup-filename>
  npm run dev -- ai models
  npm run dev -- ai health
  npm run dev -- ai chat "Your prompt"
  npm run dev -- ai benchmark [max-output-tokens]
  npm run dev -- agent list
  npm run dev -- agent show <agent-id>
  npm run dev -- agent run <agent-id> "Your prompt"
  npm run dev -- memory add <type> <scope> "Memory content"
  npm run dev -- memory search "Search query"
  npm run dev -- memory list
  npm run dev -- memory archive <memory-id>
  npm run dev -- permission list
  npm run dev -- permission remove <rule-id>
  npm run dev -- audit list [--entity <type>] [--id <entity-id>] [--limit <1-500>]
  npm run dev -- plan create "Describe the goal to plan"
  npm run dev -- plan list
  npm run dev -- plan show <plan-id>
  npm run dev -- plan approve <plan-id>
  npm run dev -- plan reject <plan-id>
  npm run dev -- permission set <actor> <tool> <action> <target-pattern> <allow|deny|approval_required>
  npm run dev -- approval list [--all]
  npm run dev -- approval approve <approval-id>
  npm run dev -- approval reject <approval-id>
  npm run dev -- run start <approved-plan-id>
  npm run dev -- run execute <run-id> [approval-id]
  npm run dev -- run list
  npm run dev -- run show <run-id>
  npm run dev -- run step start <run-id> <step-id>
  npm run dev -- run step complete <run-id> <step-id> ["result"]
  npm run dev -- run step fail <run-id> <step-id> "reason"
  npm run dev -- run step execute <run-id> <step-id> [approval-id]  # execute the saved plan action
  npm run dev -- run recover <run-id> --confirm-process-stopped
  npm run dev -- run resume <run-id>
  npm run dev -- run cancel <run-id>
`);
}

async function main(): Promise<void> {
  const [command, subcommand, ...args] = process.argv.slice(2);
  const config = loadConfig();
  const database = openDatabase(config);
  let databaseOpen = true;
  const logger = new ScopyLogger(config.logsDir);
  logger.info("cli.command.started", { command: command ?? "unknown", subcommand: subcommand ?? null });

  try {
    if (command === "doctor") {
      const report = await runDoctor(config, database);
      console.log(JSON.stringify(report, null, 2));
      if (!report.healthy) process.exitCode = 1;
      return;
    }

    if (command === "health") {
      console.log(JSON.stringify({
        status: "ok",
        app: "Scopy",
        database: "connected",
        dataDirectory: config.dataDir,
      }, null, 2));
      return;
    }

    if (command === "ai") {
      if (subcommand === "models") {
        const baseUrl = process.env.SCOPY_LOCAL_AI_URL ?? "http://127.0.0.1:8080/v1";
        const models = await listLocalModels(baseUrl, process.env.SCOPY_LOCAL_AI_API_KEY);
        console.log(JSON.stringify({ baseUrl, models }, null, 2));
        return;
      }

      const router = createLocalAiRouter(database);
      const provider = router.list()[0];
      if (!provider) throw new Error("No AI provider is configured.");

      if (subcommand === "health") {
        console.log(JSON.stringify(await router.health(provider.id), null, 2));
        return;
      }

      if (subcommand === "benchmark") {
        const maxOutputTokens = Number(args[0] ?? "256");
        if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 16 || maxOutputTokens > 2048) {
          throw new Error("Benchmark output tokens must be an integer between 16 and 2048.");
        }
        const context = { actorId: "user:local", purpose: "local CLI benchmark" };
        const warmup = await router.generate(provider.id, {
          messages: [{ role: "user", content: "Reply with a short TypeScript example of a typed function." }],
          temperature: 0,
          maxOutputTokens: 32,
        }, context);
        const measured = await router.generate(provider.id, {
          messages: [{
            role: "user",
            content: "Write a detailed TypeScript implementation of a bounded asynchronous task queue. Include typed task and result interfaces, concurrency limits, error handling, cancellation behavior, and a small usage example. Explain the design briefly.",
          }],
          temperature: 0,
          maxOutputTokens,
        }, context);
        const tokensPerSecond = measured.outputTokens !== undefined && measured.durationMs > 0
          ? Number((measured.outputTokens / (measured.durationMs / 1000)).toFixed(2))
          : null;
        console.log(JSON.stringify({
          providerId: measured.providerId,
          model: measured.model,
          warmup: {
            outputTokens: warmup.outputTokens ?? null,
            durationMs: warmup.durationMs,
          },
          benchmark: {
            inputTokens: measured.inputTokens ?? null,
            outputTokens: measured.outputTokens ?? null,
            requestedMaxOutputTokens: maxOutputTokens,
            durationMs: measured.durationMs,
            clientObservedTokensPerSecond: tokensPerSecond,
          },
          note: "Client-observed end-to-end rate; includes HTTP and server scheduling latency.",
        }, null, 2));
        return;
      }

      if (subcommand === "chat") {
        const prompt = args.join(" ").trim();
        if (!prompt) {
          console.error("Provide a prompt.");
          process.exitCode = 1;
          return;
        }
        const projectContext = await loadProjectContext();
        const memories = new MemoryRepository(database).search(prompt, { limit: 5 });
        const assistantProfile = new AgentRegistry().get("assistant");
        const result = await router.generate(provider.id, {
          messages: buildAgentMessages(assistantProfile, prompt, projectContext, memories),
          temperature: 0.2,
          maxOutputTokens: 1_800,
        }, {
          actorId: "user:local",
          purpose: "local CLI chat",
        });
        console.log(result.text);
        return;
      }

      printUsage();
      process.exitCode = 1;
      return;
    }

    if (command === "agent") {
      const registry = new AgentRegistry();
      if (subcommand === "list") {
        console.log(JSON.stringify(registry.list().map(({ systemPrompt, ...agent }) => agent), null, 2));
        return;
      }
      const agentId = args[0];
      if (!agentId) throw new Error("Usage: agent <list|show|run> <agent-id> [prompt]");
      const profile = registry.get(agentId);
      if (subcommand === "show") {
        console.log(JSON.stringify(profile, null, 2));
        return;
      }
      if (subcommand === "run") {
        const prompt = args.slice(1).join(" ").trim();
        if (!prompt) throw new Error('Usage: agent run <agent-id> "Your prompt"');
        const router = createLocalAiRouter(database);
        const provider = router.list()[0];
        if (!provider) throw new Error("No AI provider is configured.");
        const projectContext = await loadProjectContext();
        const memories = new MemoryRepository(database).search(prompt, { limit: 5 });
        const result = await router.generate(provider.id, {
          messages: buildAgentMessages(profile, prompt, projectContext, memories),
          temperature: 0.2,
          maxOutputTokens: 1_800,
        }, {
          actorId: "user:local",
          purpose: "local agent chat: " + profile.id,
        });
        console.log(result.text);
        return;
      }
      throw new Error("Usage: agent <list|show|run> <agent-id> [prompt]");
    }

    if (command === "audit") {
      if (subcommand !== "list") throw new Error("Usage: audit list [--entity <type>] [--id <entity-id>] [--limit <1-500>]");
      const readOption = (name: string): string | undefined => {
        const index = args.indexOf(name);
        if (index < 0) return undefined;
        const value = args[index + 1];
        if (!value || value.startsWith("--")) throw new Error("Provide a value after " + name + ".");
        return value;
      };
      const rawLimit = readOption("--limit");
      const entityType = readOption("--entity");
      const entityId = readOption("--id");
      const limit = rawLimit === undefined ? 100 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Audit limit must be between 1 and 500.");
      const audit = new AuditRepository(database);
      console.log(JSON.stringify(audit.list({
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        limit,
      }), null, 2));
      return;
    }

    if (command === "memory") {
      const memories = new MemoryRepository(database);
      if (subcommand === "add") {
        const [type, scope, ...contentParts] = args;
        const content = contentParts.join(" ").trim();
        if (!type || !scope || !content) {
          console.error("Usage: memory add <type> <scope> \"Memory content\"");
          process.exitCode = 1;
          return;
        }
        console.log(JSON.stringify(memories.create({
          type: type as MemoryType,
          scope,
          content,
          sourceType: "user_confirmed",
          sourceRef: "cli",
          confidence: 1,
        }), null, 2));
        return;
      }
      if (subcommand === "search") {
        const query = args.join(" ").trim();
        console.log(JSON.stringify(memories.search(query), null, 2));
        return;
      }
      if (subcommand === "list") {
        console.log(JSON.stringify(memories.list(), null, 2));
        return;
      }
      if (subcommand === "archive") {
        const id = args[0];
        if (!id) throw new Error("Usage: memory archive <memory-id>");
        const archived = memories.archive(id);
        console.log(JSON.stringify({ id, archived }, null, 2));
        return;
      }
      printUsage();
      process.exitCode = 1;
      return;
    }

    if (command === "backup") {
      const backups = new BackupService(database, config.homeDir);
      if (subcommand === "create") {
        console.log(JSON.stringify(await backups.create(), null, 2));
        return;
      }
      if (subcommand === "list") {
        console.log(JSON.stringify(await backups.list(), null, 2));
        return;
      }
      if (subcommand === "verify") {
        const name = args[0];
        if (!name) throw new Error("Usage: backup verify <backup-filename>");
        console.log(JSON.stringify(backups.verify(name), null, 2));
        return;
      }
      if (subcommand === "restore") {
        const name = args[0];
        if (!name || args.length !== 1) throw new Error("Usage: backup restore <backup-filename>");
        const currentSchema = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null };
        if (currentSchema.version === null) throw new Error("Current Scopy database schema is missing.");
        const candidate = backups.verify(name);
        if (candidate.migrationVersion !== currentSchema.version) {
          throw new Error(`Backup schema version ${candidate.migrationVersion} does not match current schema version ${currentSchema.version}.`);
        }
        const safetyBackup = await backups.create();
        database.close();
        databaseOpen = false;
        const restored = await restoreBackupSnapshot(config.databasePath, config.backupsDir, name, currentSchema.version);
        console.log(JSON.stringify({
          ...restored,
          safetyBackup: safetyBackup.name,
          notice: "Restore completed. A verified pre-restore safety backup was retained in the backups directory.",
        }, null, 2));
        return;
      }
      throw new Error("Usage: backup <create|list|verify|restore> [backup-filename]");
    }

    if (command === "project") {
      const projects = new ProjectRepository(database);
      if (subcommand === "create") {
        const [name, ...descriptionParts] = args;
        if (!name) throw new Error('Usage: project create "Project name" ["Description"]');
        console.log(JSON.stringify(projects.create({ name, description: descriptionParts.join(" ") }), null, 2));
        return;
      }
      if (subcommand === "list") {
        console.log(JSON.stringify(projects.list({ includeArchived: args.includes("--all") }), null, 2));
        return;
      }
      if (subcommand === "show") {
        const id = args[0];
        if (!id) throw new Error("Usage: project show <project-id>");
        const project = projects.getById(id);
        if (!project) throw new Error("Project not found: " + id);
        const tasks = new TaskRepository(database).list({ projectId: id });
        console.log(JSON.stringify({ project, tasks }, null, 2));
        return;
      }
    if (subcommand === "update") {
        const [id, field, ...valueParts] = args;
        const value = valueParts.join(" ").trim();
        if (!id || !field || !value) throw new Error("Usage: project update <project-id> <name|description> <value>");
        if (field === "name") console.log(JSON.stringify(projects.update(id, { name: value }), null, 2));
        else if (field === "description") console.log(JSON.stringify(projects.update(id, { description: value }), null, 2));
        else throw new Error("Project field must be name or description.");
        return;
      }
      if (subcommand === "archive") {
        const id = args[0];
        if (!id) throw new Error("Usage: project archive <project-id>");
        console.log(JSON.stringify(projects.archive(id), null, 2));
        return;
      }
      printUsage();
      process.exitCode = 1;
      return;
    }

    if (command === "plan") {
      const plans = new PlanRepository(database);
      if (subcommand === "create") {
        const goal = args.join(" ").trim();
        if (!goal) throw new Error('Usage: plan create "Describe the goal to plan"');
        const router = createLocalAiRouter(database);
        const provider = router.list()[0];
        if (!provider) throw new Error("No AI provider is configured.");
        const plan = await generateDraftPlan(router, provider.id, plans, goal);
        console.log(JSON.stringify({
          ...plan,
          notice: "Saved as DRAFT. Review every step before approving. Approval does not execute the plan.",
        }, null, 2));
        return;
      }
      if (subcommand === "list") {
        console.log(JSON.stringify(plans.list(), null, 2));
        return;
      }
      if (subcommand === "show") {
        const id = args[0];
        if (!id) throw new Error("Usage: plan show <plan-id>");
        const plan = plans.getById(id);
        if (!plan) throw new Error(`Plan not found: ${id}`);
        console.log(JSON.stringify(plan, null, 2));
        return;
      }
      if (subcommand === "approve" || subcommand === "reject") {
        const id = args[0];
        if (!id) throw new Error(`Usage: plan ${subcommand} <plan-id>`);
        const plan = plans.review(id, subcommand === "approve" ? "approved" : "rejected", "user:local");
        console.log(JSON.stringify({
          ...plan,
          notice: plan.status === "approved"
            ? "Plan approved for review purposes only. No tools or actions have been executed."
            : "Plan rejected. No tools or actions have been executed.",
        }, null, 2));
        return;
      }
      printUsage();
      process.exitCode = 1;
      return;
    }

    if (command === "permission") {
      const permissions = new PermissionRepository(database);
      if (subcommand === "list") {
        console.log(JSON.stringify(permissions.list(), null, 2));
        return;
      }
      if (subcommand === "remove") {
        const id = args[0];
        if (!id) throw new Error("Usage: permission remove <rule-id>");
        console.log(JSON.stringify({ id, removed: permissions.removeRule(id) }, null, 2));
        return;
      }
      if (subcommand !== "set") throw new Error("Usage: permission <list|set|remove> ...");
      const [actorId, tool, action, targetPattern, effect] = args;
      if (!actorId || !tool || !action || !targetPattern ||
        (effect !== "allow" && effect !== "deny" && effect !== "approval_required")) {
        throw new Error("Usage: permission set <actor> <tool> <action> <target-pattern> <allow|deny|approval_required>");
      }
      console.log(JSON.stringify(permissions.setRule({
        actorId, tool, action, targetPattern, effect,
      }), null, 2));
      return;
    }

    if (command === "approval") {
      const permissions = new PermissionRepository(database);
      const policy = new PolicyEngine(permissions);
      const approvals = new ApprovalService(database, policy);
      if (subcommand === "list") {
        console.log(JSON.stringify(args.includes("--all") ? approvals.listAll() : approvals.listPending(), null, 2));
        return;
      }
      const id = args[0];
      if (!id || (subcommand !== "approve" && subcommand !== "reject")) {
        throw new Error("Usage: approval <list|approve|reject> [approval-id]");
      }
      const reviewed = subcommand === "approve"
        ? approvals.approve(id, "user:local")
        : approvals.reject(id, "user:local");
      console.log(JSON.stringify(reviewed, null, 2));
      return;
    }

    if (command === "run") {
      const runs = new PlanRunRepository(database);
      if (subcommand === "execute") {
        const [runId, approvalId, extra] = args;
        if (!runId || extra) throw new Error("Usage: run execute <run-id> [approval-id]");
        const permissions = new PermissionRepository(database);
        const policy = new PolicyEngine(permissions);
        const approvals = new ApprovalService(database, policy);
        const gateway = new ToolGateway(new ExecutionGuard(database, policy, approvals));
        new FilesystemTool({ workspaceRoot: config.workspaceDir }).register(gateway);
        const runtime = new RuntimeEngine(database, gateway);
        const executor = new PlanStepExecutor(runs, policy, approvals, runtime, logger);
        const result = await executor.executeReadySteps(runId, {}, approvalId);
        console.log(JSON.stringify({
          ...result,
          notice: result.pausedAt?.reason === "approval_required"
            ? "Execution paused. Review the exact approval request, approve it, then rerun this command with the approval ID."
            : result.pausedAt?.reason === "manual_step"
              ? "Execution paused at a manual step. Complete or fail that step explicitly before continuing."
              : result.pausedAt?.reason === "in_flight"
                ? "Execution paused because a step is already running. Do not start another action; inspect or recover only after confirming the prior process stopped."
                : result.pausedAt?.reason === "blocked"
                  ? "Execution paused because no step is currently ready. Inspect dependencies and run state."
                  : "All executable steps have finished or the run is already terminal.",
        }, null, 2));
        return;
      }

      if (subcommand === "start") {
        const planId = args[0];
        if (!planId) throw new Error("Usage: run start <approved-plan-id>");
        const run = runs.start(planId, "user:local");
        console.log(JSON.stringify({
          ...run,
          notice: "Run created. Steps can be manually tracked or executed through the guarded CLI tool path; model-generated text is not executed as a tool call.",
        }, null, 2));
        return;
      }
      if (subcommand === "list") {
        console.log(JSON.stringify(runs.list(), null, 2));
        return;
      }
      if (subcommand === "show") {
        const id = args[0];
        if (!id) throw new Error("Usage: run show <run-id>");
        const run = runs.getById(id);
        if (!run) throw new Error(`Plan run not found: ${id}`);
        console.log(JSON.stringify({
          ...run,
          latestCheckpoint: runs.getLatestCheckpoint(id),
          notice: "Manual step transitions are bookkeeping only. Use run step execute to invoke a typed action through policy, approvals, runtime, and the tool gateway.",
        }, null, 2));
        return;
      }
      if (subcommand === "recover") {
        const id = args[0];
        if (!id || !args.includes("--confirm-process-stopped")) {
          throw new Error("Usage: run recover <run-id> --confirm-process-stopped (only after confirming the previous Scopy process has stopped)");
        }
        console.log(JSON.stringify({
          ...runs.recoverInterrupted(id, true),
          notice: "The interrupted step is marked failed. Its external side effects are unknown; inspect them before resuming.",
        }, null, 2));
        return;
      }
      if (subcommand === "resume") {
        const id = args[0];
        if (!id) throw new Error("Usage: run resume <run-id>");
        console.log(JSON.stringify(runs.resume(id), null, 2));
        return;
      }
      if (subcommand === "cancel") {
        const id = args[0];
        if (!id) throw new Error("Usage: run cancel <run-id>");
        console.log(JSON.stringify(runs.cancel(id), null, 2));
        return;
      }
      if (subcommand === "step") {
        const [operation, runId, stepId, ...details] = args;
        if (!operation || !runId || !stepId) {
          throw new Error('Usage: run step <start|complete|fail|execute> <run-id> <step-id> [details]');
        }
        let run;
        if (operation === "execute") {
          const existingRun = runs.getById(runId);
          if (!existingRun) throw new Error(`Plan run not found: ${runId}`);
          if (details.length <= 1) {
            const permissions = new PermissionRepository(database);
            const policy = new PolicyEngine(permissions);
            const approvals = new ApprovalService(database, policy);
            const gateway = new ToolGateway(new ExecutionGuard(database, policy, approvals));
            new FilesystemTool({ workspaceRoot: config.workspaceDir }).register(gateway);
            const runtime = new RuntimeEngine(database, gateway);
            const executor = new PlanStepExecutor(runs, policy, approvals, runtime, logger);
            try {
              const result = await executor.executePlanned(runId, stepId, {}, details[0]);
              console.log(JSON.stringify(result, null, 2));
            } catch (error) {
              if (error instanceof Error && error.name === "PlanStepApprovalRequiredError" && "approval" in error) {
                console.log(JSON.stringify({ status: "approval_required", approval: (error as Error & { approval: unknown }).approval }, null, 2));
                return;
              }
              throw error;
            }
            return;
          }
          const [tool, action, target, ...executionArgs] = details;
          const payloadJson = executionArgs[0]?.trim().startsWith("{") ? executionArgs[0] : undefined;
          const approvalId = payloadJson ? executionArgs[1] : executionArgs[0];
          if (!tool || !action || !target) {
            throw new Error('Usage: run step execute <run-id> <step-id> filesystem <read|write> <workspace-relative-path> [payload-json] [approval-id]');
          }
          if (tool !== "filesystem") {
            throw new Error("The CLI currently registers only the filesystem tool for plan-step execution.");
          }
          if (action !== "read" && action !== "write") {
            throw new Error("Filesystem action must be read or write.");
          }
          let payload: Record<string, unknown> = {};
          if (payloadJson) {
            const parsed: unknown = JSON.parse(payloadJson);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              throw new Error("Action payload must be a JSON object.");
            }
            payload = parsed as Record<string, unknown>;
          }
          if (action === "write" && typeof payload.content !== "string") {
            throw new Error('Filesystem write requires payload JSON with a string "content" field.');
          }
          const permissions = new PermissionRepository(database);
          const policy = new PolicyEngine(permissions);
          const approvals = new ApprovalService(database, policy);
          const gateway = new ToolGateway(new ExecutionGuard(database, policy, approvals));
          new FilesystemTool({ workspaceRoot: config.workspaceDir }).register(gateway);
          const runtime = new RuntimeEngine(database, gateway);
          const executor = new PlanStepExecutor(runs, policy, approvals, runtime, logger);
          const result = await executor.execute(runId, stepId, {
            actorId: existingRun.startedBy, tool, action, target, payload,
          }, {}, approvalId);
          console.log(JSON.stringify(result, null, 2));
          return;
        } else if (operation === "start") {
          run = runs.startStep(runId, stepId);
        } else if (operation === "complete") {
          run = runs.completeStep(runId, stepId, details.join(" "));
        } else if (operation === "fail") {
          run = runs.failStep(runId, stepId, details.join(" "));
        } else {
          throw new Error("Unknown run step operation. Use start, complete, fail, or execute.");
        }
        console.log(JSON.stringify(run, null, 2));
        return;
      }
      printUsage();
      process.exitCode = 1;
      return;
    }

    if (command !== "task") {
      printUsage();
      process.exitCode = 1;
      return;
    }

    const tasks = new TaskRepository(database);

    if (subcommand === "add") {
      const projectIndex = args.indexOf("--project");
      const projectId = projectIndex >= 0 ? args[projectIndex + 1] : undefined;
      const title = (projectIndex >= 0 ? args.slice(0, projectIndex) : args).join(" ").trim();
      if (!title || (projectIndex >= 0 && !projectId)) {
        throw new Error('Usage: task add "Task title" [--project <project-id>]');
      }
      console.log(JSON.stringify(tasks.create({ title, ...(projectId ? { projectId } : {}) }), null, 2));
      return;
    }

    if (subcommand === "list") {
      const projectIndex = args.indexOf("--project");
      const statusIndex = args.indexOf("--status");
      const projectValue = projectIndex >= 0 ? args[projectIndex + 1] : undefined;
      const statusValue = statusIndex >= 0 ? args[statusIndex + 1] : undefined;
      const allowedStatuses: TaskStatus[] = ["open", "in_progress", "completed", "cancelled"];
      if (projectIndex >= 0 && !projectValue) throw new Error("Provide a project ID after --project.");
      if (statusValue && !allowedStatuses.includes(statusValue as TaskStatus)) throw new Error("Invalid task status.");
      const items = tasks.list({
        ...(projectValue !== undefined ? { projectId: projectValue === "none" ? null : projectValue } : {}),
        ...(statusValue ? { status: statusValue as TaskStatus } : {}),
      });
      if (items.length === 0) {
        console.log("No tasks found.");
      } else {
        for (const task of items) {
          console.log(`[${task.status}] [${task.priority}] ${task.title} — ${task.id}${task.projectId ? " (project " + task.projectId + ")" : ""}`);
        }
      }
      return;
    }

    if (subcommand === "show") {
      const id = args[0];
      if (!id) throw new Error("Usage: task show <task-id>");
      const task = tasks.getById(id);
      if (!task) throw new TaskNotFoundError(id);
      console.log(JSON.stringify(task, null, 2));
      return;
    }

    if (subcommand === "update") {
      const [id, field, ...valueParts] = args;
      const value = valueParts.join(" ").trim();
      if (!id || !field || !value) throw new Error("Usage: task update <task-id> <title|description|status|priority|project> <value>");
      if (field === "title") console.log(JSON.stringify(tasks.update(id, { title: value }), null, 2));
      else if (field === "description") console.log(JSON.stringify(tasks.update(id, { description: value }), null, 2));
      else if (field === "status") {
        const allowed: TaskStatus[] = ["open", "in_progress", "completed", "cancelled"];
        if (!allowed.includes(value as TaskStatus)) throw new Error("Invalid task status.");
        console.log(JSON.stringify(tasks.update(id, { status: value as TaskStatus }), null, 2));
      } else if (field === "priority") {
        const allowed: TaskPriority[] = ["low", "normal", "high", "urgent"];
        if (!allowed.includes(value as TaskPriority)) throw new Error("Invalid task priority.");
        console.log(JSON.stringify(tasks.update(id, { priority: value as TaskPriority }), null, 2));
      } else if (field === "project") {
        console.log(JSON.stringify(tasks.update(id, { projectId: value === "none" ? null : value }), null, 2));
      } else {
        throw new Error("Unknown task field. Use title, description, status, priority, or project.");
      }
      return;
    }

    if (subcommand === "complete") {
      const id = args[0];
      if (!id) {
        console.error("Provide a task ID.");
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(tasks.complete(id), null, 2));
      return;
    }

    printUsage();
    process.exitCode = 1;
  } catch (error) {
    logger.error("cli.command.failed", {
      command: command ?? "unknown",
      subcommand: subcommand ?? null,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    if (error instanceof TaskNotFoundError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    if (databaseOpen) database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Scopy encountered an unexpected error.");
  process.exitCode = 1;
});
