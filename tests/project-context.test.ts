import assert from "node:assert/strict";
import test from "node:test";
import { formatTrackedInventory } from "../src/project/project-context.js";

test("live repository inventory lists exact paths in stable order", () => {
  const inventory = formatTrackedInventory([
    "src/tasks/task-repository.ts",
    "src/ai/chat-context.ts",
  ]);
  const aiIndex = inventory.indexOf("src/ai/chat-context.ts");
  const taskIndex = inventory.indexOf("src/tasks/task-repository.ts");
  assert.ok(aiIndex >= 0);
  assert.ok(taskIndex > aiIndex);
  assert.match(inventory, /read-only git ls-files/);
  assert.match(inventory, /not proposed architecture paths/);
});

test("live inventory does not claim that test files passed", () => {
  const inventory = formatTrackedInventory(["tests/example.test.ts"]);
  assert.match(inventory, /does not prove that its tests pass/);
  assert.doesNotMatch(inventory, /tests passed/i);
});
