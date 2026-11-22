import { createLocalAiRouter } from "./ai/create-local-router.js";
import { listLocalModels } from "./ai/local-openai-provider.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { MemoryRepository, type MemoryType } from "./memory/memory-repository.js";
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
        const result = await router.generate(provider.id, {
          messages: [{ role: "user", content: prompt }],
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
