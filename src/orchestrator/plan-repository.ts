import { randomUUID } from "node:crypto";
import type { ScopyDatabase } from "../db/database.js";
import type {
  GeneratedPlanDraft,
  OrchestratorPlan,
  PlanStatus,
  PlanStepDraft,
} from "./plan.js";
import { validateGeneratedPlan } from "./plan.js";

interface PlanRow {
  id: string;
  goal: string;
  summary: string;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

interface StepRow {
  id: string;
  title: string;
  description: string;
  expected_output: string;
  risk: "low" | "medium" | "high";
  dependencies_json: string;
}

function mapPlan(row: PlanRow, steps: readonly StepRow[]): OrchestratorPlan {
  return {
    id: row.id,
    goal: row.goal,
    summary: row.summary,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    steps: steps.map((step): PlanStepDraft => ({
      id: step.id,
      title: step.title,
      description: step.description,
      expectedOutput: step.expected_output,
      risk: step.risk,
      dependsOn: JSON.parse(step.dependencies_json) as string[],
    })),
  };
}

export class PlanNotFoundError extends Error {
  constructor(id: string) {
    super(`Plan not found: ${id}`);
    this.name = "PlanNotFoundError";
  }
}

export class PlanRepository {
  constructor(private readonly database: ScopyDatabase) {}

  create(goal: string, draft: GeneratedPlanDraft): OrchestratorPlan {
    const normalizedGoal = goal.trim();
    if (normalizedGoal.length < 1 || normalizedGoal.length > 2_000) {
      throw new Error("Plan goal must contain between 1 and 2000 characters.");
    }
    const validatedDraft = validateGeneratedPlan(draft);
    const id = randomUUID();
    const now = new Date().toISOString();
    const save = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO orchestrator_plans (id, goal, summary, status, created_at, updated_at)
        VALUES (?, ?, ?, 'draft', ?, ?)
      `).run(id, normalizedGoal, validatedDraft.summary, now, now);

      const insertStep = this.database.prepare(`
        INSERT INTO orchestrator_plan_steps (
          id, plan_id, position, title, description, expected_output, risk,
          dependencies_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      validatedDraft.steps.forEach((step, index) => {
        insertStep.run(
          step.id, id, index + 1, step.title, step.description,
          step.expectedOutput, step.risk, JSON.stringify(step.dependsOn), now,
        );
      });
      this.audit(id, "orchestrator.plan.created", {
        goal: normalizedGoal,
        stepCount: validatedDraft.steps.length,
        status: "draft",
      }, now);
    });
    save();
    return this.getById(id)!;
  }

  getById(id: string): OrchestratorPlan | null {
    const row = this.database.prepare(
      "SELECT * FROM orchestrator_plans WHERE id = ?",
    ).get(id) as PlanRow | undefined;
    if (!row) return null;
    const steps = this.database.prepare(`
      SELECT id, title, description, expected_output, risk, dependencies_json
      FROM orchestrator_plan_steps WHERE plan_id = ? ORDER BY position ASC
    `).all(id) as StepRow[];
    return mapPlan(row, steps);
  }

  list(limit = 50): OrchestratorPlan[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Plan list limit must be between 1 and 100.");
    }
    const rows = this.database.prepare(`
      SELECT * FROM orchestrator_plans ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(limit) as PlanRow[];
    return rows.map((row) => {
      const steps = this.database.prepare(`
        SELECT id, title, description, expected_output, risk, dependencies_json
        FROM orchestrator_plan_steps WHERE plan_id = ? ORDER BY position ASC
      `).all(row.id) as StepRow[];
      return mapPlan(row, steps);
    });
  }

  review(id: string, decision: "approved" | "rejected", reviewerId: string): OrchestratorPlan {
    const reviewer = reviewerId.trim();
    if (!reviewer) throw new Error("Reviewer ID cannot be empty.");
    const now = new Date().toISOString();
    const review = this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE orchestrator_plans
        SET status = ?, updated_at = ?, reviewed_at = ?, reviewed_by = ?
        WHERE id = ? AND status = 'draft'
      `).run(decision, now, now, reviewer, id);
      if (result.changes !== 1) {
        if (!this.getById(id)) throw new PlanNotFoundError(id);
        throw new Error("Only a draft plan can be reviewed; this plan is already reviewed.");
      }
      this.audit(id, `orchestrator.plan.${decision}`, { reviewerId: reviewer }, now);
    });
    review();
    return this.getById(id)!;
  }

  private audit(
    planId: string,
    eventType: string,
    payload: Record<string, unknown>,
    createdAt: string,
  ): void {
    this.database.prepare(`
      INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, 'orchestrator_plan', ?, ?, ?)
    `).run(randomUUID(), eventType, planId, JSON.stringify(payload), createdAt);
  }
}
