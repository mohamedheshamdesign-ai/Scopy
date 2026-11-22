import { loadConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { TaskNotFoundError, TaskRepository } from "./tasks/task-repository.js";

function printUsage(): void {
  console.log(`
Scopy local core

Commands:
  npm run dev -- health
  npm run dev -- task add "Task title"
  npm run dev -- task list
  npm run dev -- task complete <task-id>
`);
}

function main(): void {
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

main();
