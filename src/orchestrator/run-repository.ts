import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import type { ScopyDatabase } from "../db/database.js";
import type { PlanAction, PlanRisk, PlanStatus } from "./plan.js";

export type PlanRunStatus = "running" | "succeeded" | "failed" | "cancelled";
export type PlanRunStepStatus = "pending" | "ready" | "running" | "succeeded" | "failed" | "skipped";

export interface PlanRunStep {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  readonly description: string;
  readonly expectedOutput: string;
  readonly risk: PlanRisk;
  readonly dependsOn: readonly string[];
  readonly action?: PlanAction;
  readonly status: PlanRunStepStatus;
  readonly attemptCount: number;
  readonly result: string | null;
  readonly error: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface PlanRun {
  readonly id: string;
  readonly planId: string;
  readonly status: PlanRunStatus;
  readonly startedBy: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
  readonly error: string | null;
  readonly steps: readonly PlanRunStep[];
}

interface RunRow {
  id: string;
  plan_id: string;
  status: PlanRunStatus;
  started_by: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  error_text: string | null;
}

interface RunStepRow {
  step_id: string;
  position: number;
  title: string;
  description: string;
  expected_output: string;
  risk: PlanRisk;
  dependencies_json: string;
  action_json: string | null;
  status: PlanRunStepStatus;
  attempt_count: number;
  result_text: string | null;
  error_text: string | null;
  started_at: string | null;
  finished_at: string | null;
}

function mapRun(row: RunRow, steps: readonly RunStepRow[]): PlanRun {
  return {
    id: row.id,
    planId: row.plan_id,
    status: row.status,
    startedBy: row.started_by,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    error: row.error_text,
    steps: steps.map((step) => ({
      id: step.step_id,
      position: step.position,
      title: step.title,
      description: step.description,
      expectedOutput: step.expected_output,
      risk: step.risk,
      dependsOn: JSON.parse(step.dependencies_json) as string[],
      ...(step.action_json ? { action: JSON.parse(step.action_json) as PlanAction } : {}),
      status: step.status,
      attemptCount: step.attempt_count,
      result: step.result_text,
      error: step.error_text,
      startedAt: step.started_at,
      finishedAt: step.finished_at,
    })),
  };
}

export class PlanRunNotFoundError extends Error {
  constructor(id: string) {
    super(`Plan run not found: ${id}`);
    this.name = "PlanRunNotFoundError";
  }
}

export class PlanRunRepository {
  constructor(private readonly database: ScopyDatabase) {}

  start(planId: string, startedBy: string): PlanRun {
    const actor = startedBy.trim();
    if (!actor) throw new Error("Run starter ID cannot be empty.");
    const plan = this.database.prepare(
      "SELECT id, status FROM orchestrator_plans WHERE id = ?",
    ).get(planId) as { id: string; status: PlanStatus } | undefined;
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    if (plan.status !== "approved") {
      throw new Error("Only an approved plan can be started.");
    }

    const sourceSteps = this.database.prepare(`
      SELECT id, position, title, description, expected_output, risk, dependencies_json, action_json
      FROM orchestrator_plan_steps WHERE plan_id = ? ORDER BY position ASC
    `).all(planId) as Array<{
      id: string; position: number; title: string; description: string;
      expected_output: string; risk: PlanRisk; dependencies_json: string; action_json: string | null;
    }>;
    if (sourceSteps.length === 0) throw new Error("Cannot start a plan without steps.");

    const id = randomUUID();
    const now = new Date().toISOString();
    const create = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO orchestrator_runs (id, plan_id, status, started_by, started_at, updated_at)
        VALUES (?, ?, 'running', ?, ?, ?)
      `).run(id, planId, actor, now, now);

      const insertStep = this.database.prepare(`
        INSERT INTO orchestrator_run_steps (
          run_id, step_id, position, title, description, expected_output, risk,
          dependencies_json, action_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const step of sourceSteps) {
        const dependencies = JSON.parse(step.dependencies_json) as string[];
        insertStep.run(
          id, step.id, step.position, step.title, step.description,
          step.expected_output, step.risk, step.dependencies_json, step.action_json,
          dependencies.length === 0 ? "ready" : "pending",
        );
      }
      this.audit(id, "orchestrator.run.started", { planId, startedBy: actor }, now);
      this.saveCheckpoint(id, "run.started", now);
    });
    create();
    return this.getById(id)!;
  }

  getById(id: string): PlanRun | null {
    const row = this.database.prepare(
      "SELECT * FROM orchestrator_runs WHERE id = ?",
    ).get(id) as RunRow | undefined;
    if (!row) return null;
    const steps = this.database.prepare(`
      SELECT * FROM orchestrator_run_steps WHERE run_id = ? ORDER BY position ASC
    `).all(id) as RunStepRow[];
    return mapRun(row, steps);
  }

  list(limit = 50): PlanRun[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Run list limit must be between 1 and 100.");
    }
    const rows = this.database.prepare(`
      SELECT * FROM orchestrator_runs ORDER BY started_at DESC, id DESC LIMIT ?
    `).all(limit) as RunRow[];
    return rows.map((row) => {
      const steps = this.database.prepare(`
        SELECT * FROM orchestrator_run_steps WHERE run_id = ? ORDER BY position ASC
      `).all(row.id) as RunStepRow[];
      return mapRun(row, steps);
    });
  }

  startStep(runId: string, stepId: string, guardedAction = false): PlanRun {
    const now = new Date().toISOString();
    const transition = this.database.transaction(() => {
      const run = this.requireRun(runId);
      if (run.status !== "running") throw new Error("Only a running plan run can start a step.");
      const step = this.getStep(runId, stepId);
      if (!step) throw new Error(`Step not found in run: ${stepId}`);
      if (step.status !== "ready") throw new Error("Only a ready step can be started.");
      if (step.action_json && !guardedAction) throw new Error("This step contains a typed action and must be started through guarded execution.");
      const active = this.database.prepare(
        "SELECT step_id FROM orchestrator_run_steps WHERE run_id = ? AND status = 'running'",
      ).get(runId);
      if (active) throw new Error("A step is already running; complete or fail it before starting another.");
      const dependencies = JSON.parse(step.dependencies_json) as string[];
      for (const dependency of dependencies) {
        const dependencyStep = this.getStep(runId, dependency);
        if (!dependencyStep || dependencyStep.status !== "succeeded") {
          throw new Error(`Step ${stepId} is blocked by dependency ${dependency}.`);
        }
      }
      this.database.prepare(`
        UPDATE orchestrator_run_steps
        SET status = 'running', attempt_count = attempt_count + 1,
            started_at = ?, finished_at = NULL, result_text = NULL, error_text = NULL
        WHERE run_id = ? AND step_id = ? AND status = 'ready'
      `).run(now, runId, stepId);
      this.touchRun(runId, now);
      this.audit(runId, "orchestrator.step.started", { stepId, attempt: step.attempt_count + 1 }, now);
      this.saveCheckpoint(runId, "step.started", now);
    });
    transition();
    return this.getById(runId)!;
  }

  completeStep(runId: string, stepId: string, result = "", guardedAction = false): PlanRun {
    const normalized = result.trim();
    if (normalized.length > 4_000) throw new Error("Step result cannot exceed 4000 characters.");
    const now = new Date().toISOString();
    const transition = this.database.transaction(() => {
      const run = this.requireRun(runId);
      if (run.status !== "running") throw new Error("Only a running plan run can complete a step.");
      const step = this.getStep(runId, stepId);
      if (!step) throw new Error(`Step not found in run: ${stepId}`);
      if (step.status !== "running") throw new Error("Only a running step can be completed.");
      if (step.action_json && !guardedAction) throw new Error("This typed-action step can only be completed by the guarded executor after a successful tool result.");
      this.database.prepare(`
        UPDATE orchestrator_run_steps
        SET status = 'succeeded', result_text = ?, error_text = NULL, finished_at = ?
        WHERE run_id = ? AND step_id = ? AND status = 'running'
      `).run(normalized || null, now, runId, stepId);
      this.refreshReadySteps(runId);
      const counts = this.database.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded
        FROM orchestrator_run_steps WHERE run_id = ?
      `).get(runId) as { total: number; succeeded: number };
      if (counts.total > 0 && counts.total === counts.succeeded) {
        this.database.prepare(`
          UPDATE orchestrator_runs SET status = 'succeeded', updated_at = ?, finished_at = ?
          WHERE id = ? AND status = 'running'
        `).run(now, now, runId);
      } else {
        this.touchRun(runId, now);
      }
      this.audit(runId, "orchestrator.step.succeeded", { stepId, result: normalized }, now);
      if (this.requireRun(runId).status === "succeeded") {
        this.audit(runId, "orchestrator.run.succeeded", { stepId }, now);
      }
      this.saveCheckpoint(runId, "step.succeeded", now);
    });
    transition();
    return this.getById(runId)!;
  }

  failStep(runId: string, stepId: string, error: string): PlanRun {
    const message = error.trim();
    if (!message || message.length > 4_000) {
      throw new Error("Step failure reason must contain between 1 and 4000 characters.");
    }
    const now = new Date().toISOString();
    const transition = this.database.transaction(() => {
      const run = this.requireRun(runId);
      if (run.status !== "running") throw new Error("Only a running plan run can fail a step.");
      const step = this.getStep(runId, stepId);
      if (!step) throw new Error(`Step not found in run: ${stepId}`);
      if (step.status !== "running") throw new Error("Only a running step can be failed.");
      this.database.prepare(`
        UPDATE orchestrator_run_steps
        SET status = 'failed', error_text = ?, finished_at = ?
        WHERE run_id = ? AND step_id = ? AND status = 'running'
      `).run(message, now, runId, stepId);
      this.database.prepare(`
        UPDATE orchestrator_runs SET status = 'failed', updated_at = ?, finished_at = ?, error_text = ?
        WHERE id = ? AND status = 'running'
      `).run(now, now, message, runId);
      this.audit(runId, "orchestrator.step.failed", { stepId, error: message }, now);
      this.audit(runId, "orchestrator.run.failed", { stepId, error: message }, now);
      this.saveCheckpoint(runId, "step.failed", now);
    });
    transition();
    return this.getById(runId)!;
  }

  resume(runId: string): PlanRun {
    const now = new Date().toISOString();
    const transition = this.database.transaction(() => {
      const run = this.requireRun(runId);
      if (run.status !== "failed") throw new Error("Only a failed plan run can be resumed.");
      const failed = this.database.prepare(`
        SELECT step_id FROM orchestrator_run_steps WHERE run_id = ? AND status = 'failed'
      `).all(runId) as Array<{ step_id: string }>;
      if (failed.length !== 1) {
        throw new Error("Run cannot be safely resumed: expected exactly one failed step.");
      }
      this.database.prepare(`
        UPDATE orchestrator_run_steps
        SET status = 'ready', error_text = NULL, finished_at = NULL
        WHERE run_id = ? AND step_id = ? AND status = 'failed'
      `).run(runId, failed[0]!.step_id);
      this.database.prepare(`
        UPDATE orchestrator_runs SET status = 'running', updated_at = ?, finished_at = NULL, error_text = NULL
        WHERE id = ? AND status = 'failed'
      `).run(now, runId);
      this.audit(runId, "orchestrator.run.resumed", { stepId: failed[0]!.step_id }, now);
      this.saveCheckpoint(runId, "run.resumed", now);
    });
    transition();
    return this.getById(runId)!;
  }

  cancel(runId: string): PlanRun {
    const now = new Date().toISOString();
    const transition = this.database.transaction(() => {
      const run = this.requireRun(runId);
      if (run.status !== "running") throw new Error("Only a running plan run can be cancelled.");
      this.database.prepare(`
        UPDATE orchestrator_run_steps
        SET status = 'skipped', finished_at = ?
        WHERE run_id = ? AND status IN ('pending', 'ready', 'running')
      `).run(now, runId);
      this.database.prepare(`
        UPDATE orchestrator_runs SET status = 'cancelled', updated_at = ?, finished_at = ?
        WHERE id = ? AND status = 'running'
      `).run(now, now, runId);
      this.audit(runId, "orchestrator.run.cancelled", {}, now);
      this.saveCheckpoint(runId, "run.cancelled", now);
    });
    transition();
    return this.getById(runId)!;
  }

  getLatestCheckpoint(runId: string): unknown | null {
    const row = this.database.prepare(`
      SELECT checkpoint_json FROM orchestrator_run_checkpoints
      WHERE run_id = ? ORDER BY sequence DESC LIMIT 1
    `).get(runId) as { checkpoint_json: string } | undefined;
    return row ? JSON.parse(row.checkpoint_json) as unknown : null;
  }

  private requireRun(id: string): RunRow {
    const row = this.database.prepare(
      "SELECT * FROM orchestrator_runs WHERE id = ?",
    ).get(id) as RunRow | undefined;
    if (!row) throw new PlanRunNotFoundError(id);
    return row;
  }

  private getStep(runId: string, stepId: string): RunStepRow | undefined {
    return this.database.prepare(
      "SELECT * FROM orchestrator_run_steps WHERE run_id = ? AND step_id = ?",
    ).get(runId, stepId) as RunStepRow | undefined;
  }

  private refreshReadySteps(runId: string): void {
    const steps = this.database.prepare(
      "SELECT step_id, dependencies_json, status FROM orchestrator_run_steps WHERE run_id = ?",
    ).all(runId) as Array<{ step_id: string; dependencies_json: string; status: PlanRunStepStatus }>;
    for (const step of steps) {
      if (step.status !== "pending") continue;
      const dependencies = JSON.parse(step.dependencies_json) as string[];
      const ready = dependencies.every((dependency) =>
        this.getStep(runId, dependency)?.status === "succeeded");
      if (ready) {
        this.database.prepare(`
          UPDATE orchestrator_run_steps SET status = 'ready'
          WHERE run_id = ? AND step_id = ? AND status = 'pending'
        `).run(runId, step.step_id);
      }
    }
  }

  private touchRun(runId: string, now: string): void {
    this.database.prepare(
      "UPDATE orchestrator_runs SET updated_at = ? WHERE id = ? AND status = 'running'",
    ).run(now, runId);
  }

  private audit(runId: string, eventType: string, payload: Record<string, unknown>, now: string): void {
    this.database.prepare(`
      INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, 'orchestrator_run', ?, ?, ?)
    `).run(randomUUID(), eventType, runId, JSON.stringify(payload), now);
  }

  private saveCheckpoint(runId: string, eventType: string, now: string): void {
    const snapshot = this.getById(runId);
    if (!snapshot) throw new PlanRunNotFoundError(runId);
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized, "utf8") > 128_000) throw new Error("Run checkpoint exceeds the 128KB safety limit.");
    const row = this.database.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM orchestrator_run_checkpoints WHERE run_id = ?",
    ).get(runId) as { sequence: number };
    this.database.prepare(`
      INSERT INTO orchestrator_run_checkpoints (id, run_id, sequence, event_type, checkpoint_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), runId, row.sequence + 1, eventType, serialized, now);
  }
}
