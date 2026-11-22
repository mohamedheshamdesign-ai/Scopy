import { buildCliChatMessages } from "./ai/chat-context.js";
import { createLocalAiRouter } from "./ai/create-local-router.js";
import { listLocalModels } from "./ai/local-openai-provider.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { loadProjectContext } from "./project/project-context.js";
import { MemoryRepository, type MemoryType } from "./memory/memory-repository.js";
import { generateDraftPlan } from "./orchestrator/planner.js";
import { PlanRepository } from "./orchestrator/plan-repository.js";
import { PlanRunRepository } from "./orchestrator/run-repository.js";
import { TaskNotFoundError, TaskRepository } from "./tasks/task-repository.js";

function printUsage(): void {
  console.log(`
Scopy local core

Commands:
  npm run dev -- health
  npm run dev -- task add "Task title"
  npm run dev -- task list
  npm run dev -- task complete <task-id>
  npm run dev -- ai models
  npm run dev -- ai health
  npm run dev -- ai chat "Your prompt"
  npm run dev -- ai benchmark [max-output-tokens]
  npm run dev -- memory add <type> <scope> "Memory content"
  npm run dev -- memory search "Search query"
  npm run dev -- memory list
  npm run dev -- plan create "Describe the goal to plan"
  npm run dev -- plan list
  npm run dev -- plan show <plan-id>
  npm run dev -- plan approve <plan-id>
  npm run dev -- plan reject <plan-id>
  npm run dev -- run start <approved-plan-id>
  npm run dev -- run list
  npm run dev -- run show <run-id>
  npm run dev -- run step start <run-id> <step-id>
  npm run dev -- run step complete <run-id> <step-id> ["result"]
  npm run dev -- run step fail <run-id> <step-id> "reason"
  npm run dev -- run resume <run-id>
  npm run dev -- run cancel <run-id>
`);
}

async function main(): Promise<void> {
  const [command, subcommand, ...args] = process.argv.slice(2);
  const config = loadConfig();
  const database = openDatabase(config);

  try {
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
        const result = await router.generate(provider.id, {
          messages: buildCliChatMessages(prompt, projectContext),
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

    if (command === "run") {
      const runs = new PlanRunRepository(database);
      if (subcommand === "start") {
        const planId = args[0];
        if (!planId) throw new Error("Usage: run start <approved-plan-id>");
        const run = runs.start(planId, "user:local");
        console.log(JSON.stringify({
          ...run,
          notice: "Run created. Steps are tracked manually; no tools or external actions are executed.",
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
          notice: "Step transitions are bookkeeping only; no tools or external actions are executed.",
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
          throw new Error('Usage: run step <start|complete|fail> <run-id> <step-id> ["result or reason"]');
        }
        let run;
        if (operation === "start") {
          run = runs.startStep(runId, stepId);
        } else if (operation === "complete") {
          run = runs.completeStep(runId, stepId, details.join(" "));
        } else if (operation === "fail") {
          run = runs.failStep(runId, stepId, details.join(" "));
        } else {
          throw new Error("Unknown run step operation. Use start, complete, or fail.");
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
      const title = args.join(" ").trim();
      if (!title) {
        console.error("Provide a task title.");
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(tasks.create({ title }), null, 2));
      return;
    }

    if (subcommand === "list") {
      const items = tasks.list();
      if (items.length === 0) {
        console.log("No tasks yet.");
      } else {
        for (const task of items) {
          console.log(`[${task.status}] ${task.title} — ${task.id}`);
        }
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
    if (error instanceof TaskNotFoundError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Scopy encountered an unexpected error.");
  process.exitCode = 1;
});
