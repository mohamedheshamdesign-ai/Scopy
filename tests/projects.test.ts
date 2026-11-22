import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { ProjectNotFoundError, ProjectRepository } from "../src/projects/project-repository.js";
import { TaskRepository } from "../src/tasks/task-repository.js";

test("projects persist, archive safely, and scope linked tasks", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-project-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const projects = new ProjectRepository(database);
    const tasks = new TaskRepository(database);
    const project = projects.create({ name: "  Brand Studio  ", description: "Client and internal design work." });
    assert.equal(project.name, "Brand Studio");
    assert.equal(project.status, "active");
    const task = tasks.create({ title: "Prepare brand brief", projectId: project.id });
    assert.equal(task.projectId, project.id);
    assert.equal(tasks.list({ projectId: project.id }).length, 1);
    assert.equal(tasks.list({ projectId: null }).length, 0);
    assert.equal(projects.getById(project.id)?.id, project.id);
    assert.equal(projects.list().length, 1);
    assert.equal(projects.archive(project.id).status, "archived");
    assert.equal(projects.list().length, 0);
    assert.equal(projects.list({ includeArchived: true }).length, 1);
    assert.throws(() => tasks.create({ title: "Should not attach", projectId: project.id }), /archived/);
    assert.equal(tasks.update(task.id, { status: "in_progress" }).projectId, project.id);
    assert.throws(() => projects.archive("missing-project"), ProjectNotFoundError);
    const events = database.prepare("SELECT event_type FROM audit_events WHERE entity_type = 'project' ORDER BY rowid").all() as Array<{ event_type: string }>;
    assert.deepEqual(events.map((event) => event.event_type), ["project.created", "project.archived"]);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("task updates preserve unspecified fields and record an audit event", async () => {
  const home = await mkdtemp(join(tmpdir(), "scopy-task-update-test-"));
  const database = openDatabase(loadConfig(home));
  try {
    const tasks = new TaskRepository(database);
    const created = tasks.create({ title: "Prepare presentation", description: "First draft" });
    const updated = tasks.update(created.id, { status: "in_progress", priority: "high" });
    assert.equal(updated.title, created.title);
    assert.equal(updated.description, "First draft");
    assert.equal(updated.status, "in_progress");
    assert.equal(updated.priority, "high");
    assert.equal(updated.completedAt, null);
    assert.equal(tasks.list({ status: "in_progress" }).length, 1);
    const events = database.prepare("SELECT event_type FROM audit_events WHERE entity_id = ? ORDER BY rowid").all(created.id) as Array<{ event_type: string }>;
    assert.deepEqual(events.map((event) => event.event_type), ["task.created", "task.updated"]);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
