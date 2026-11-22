import assert from "node:assert/strict";
import test from "node:test";
import { buildCliChatMessages } from "../src/ai/chat-context.js";

test("CLI chat adds a system prompt and preserves the user prompt", () => {
  const messages = buildCliChatMessages("Hello Scopy");
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[0]?.content ?? "", /local-first personal AI assistant/);
  assert.deepEqual(messages.at(-1), { role: "user", content: "Hello Scopy" });
});

test("Scopy architecture questions receive strict project evidence rules", () => {
  const messages = buildCliChatMessages(
    "Explain the Scopy architecture",
    "# Scopy Architecture\nScopy is a local-first personal AI operating system.",
  );
  assert.equal(messages.length, 3);
  assert.match(messages[1]?.content ?? "", /repository inventory/);
  assert.match(messages[1]?.content ?? "", /Never invent, rename, or infer a path/);
  assert.match(messages[1]?.content ?? "", /test file proves that test code exists/);
  assert.match(messages[1]?.content ?? "", /local-first personal AI operating system/);
});

test("unrelated questions do not receive project documentation", () => {
  const messages = buildCliChatMessages(
    "How do I make a responsive CSS grid?",
    "# Scopy Architecture\nPrivate project notes.",
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[1]?.role, "user");
});

test("project documentation is bounded before being sent to the model", () => {
  const longDocument = "x".repeat(30_000);
  const messages = buildCliChatMessages("Explain Scopy architecture", longDocument);
  const context = messages[1]?.content ?? "";
  assert.equal(context.length, 24_000);
  assert.ok(context.endsWith("x".repeat(20_000)));
});
