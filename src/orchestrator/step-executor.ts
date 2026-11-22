import type { ApprovalRequest, ActionRequest } from "../permissions/types.js";
import { ApprovalService, hashAction } from "../permissions/approval-service.js";
import { ApprovalRequiredError, ExecutionGuard, PermissionDeniedError } from "../permissions/execution-guard.js";
import type { PolicyEngine } from "../permissions/policy-engine.js";
import type { RuntimeOptions, RuntimeResult } from "../runtime/runtime-engine.js";
import { RuntimeEngine } from "../runtime/runtime-engine.js";
import { PlanRunRepository, type PlanRun } from "./run-repository.js";
import { resolvePlanAction } from "./action-resolver.js";
import type { ScopyLogger } from "../logging/scopy-logger.js";

export class PlanStepApprovalRequiredError extends ApprovalRequiredError {
  constructor(readonly approval: ApprovalRequest) {
    super(`Step execution requires approval. Review approval request ${approval.id} before retrying this step.`);
    this.name = "PlanStepApprovalRequiredError";
  }
}

export interface PlanStepExecutionResult<T = unknown> {
  readonly run: PlanRun;
  readonly execution: RuntimeResult<T>;
}

export class PlanStepExecutor {
  constructor(
    private readonly runs: PlanRunRepository,
    private readonly policy: PolicyEngine,
    private readonly approvals: ApprovalService,
    private readonly runtime: RuntimeEngine,
    private readonly logger?: ScopyLogger,
  ) {}

  async executePlanned<T = unknown>(runId: string, stepId: string, options: RuntimeOptions = {}, approvalId?: string): Promise<PlanStepExecutionResult<T>> {
    const run = this.runs.getById(runId);
    if (!run) throw new Error(`Plan run not found: ${runId}`);
    const step = run.steps.find((item) => item.id === stepId);
    if (!step) throw new Error(`Step not found in run: ${stepId}`);
    if (!step.action) throw new Error(`Plan step ${stepId} has no supported typed action. It must be handled manually.`);
    return this.execute<T>(runId, stepId, resolvePlanAction(step.action, run.startedBy), options, approvalId);
  }

  async executeReadySteps(
    runId: string,
    options: RuntimeOptions = {},
    approvalId?: string,
  ): Promise<{
    readonly run: PlanRun;
    readonly executedStepIds: readonly string[];
    readonly pausedAt?: {
      readonly stepId?: string;
      readonly reason: "approval_required" | "manual_step" | "in_flight" | "blocked";
      readonly approval?: ApprovalRequest;
    };
  }> {
    let run = this.runs.getById(runId);
    if (!run) throw new Error(`Plan run not found: ${runId}`);
    const executedStepIds: string[] = [];
    let nextApprovalId = approvalId;

    while (run.status === "running") {
      const inFlight = run.steps.find((step) => step.status === "running");
      if (inFlight) {
        return { run, executedStepIds, pausedAt: { stepId: inFlight.id, reason: "in_flight" } };
      }
      const step = run.steps.find((item) => item.status === "ready");
      if (!step) return { run, executedStepIds, pausedAt: { reason: "blocked" } };
      if (!step.action) return { run, executedStepIds, pausedAt: { stepId: step.id, reason: "manual_step" } };

      try {
        const result = await this.executePlanned(runId, step.id, options, nextApprovalId);
        run = result.run;
        executedStepIds.push(step.id);
        nextApprovalId = undefined;
      } catch (error) {
        if (error instanceof PlanStepApprovalRequiredError) {
          const current = this.runs.getById(runId);
          if (!current) throw new Error(`Plan run disappeared during execution: ${runId}`);
          return { run: current, executedStepIds, pausedAt: { stepId: step.id, reason: "approval_required", approval: error.approval } };
        }
        throw error;
      }
    }
    return { run, executedStepIds };
  }
  async execute<T = unknown>(
    runId: string,
    stepId: string,
    request: ActionRequest,
    options: RuntimeOptions = {},
    approvalId?: string,
  ): Promise<PlanStepExecutionResult<T>> {
    const run = this.runs.getById(runId);
    if (!run) throw new Error(`Plan run not found: ${runId}`);
    if (run.status !== "running") throw new Error("Only a running plan run can execute a step.");
    if (request.actorId !== run.startedBy) {
      throw new PermissionDeniedError("The action actor must match the identity that started this plan run.");
    }
    const step = run.steps.find((item) => item.id === stepId);
    if (!step) throw new Error(`Step not found in run: ${stepId}`);
    if (step.status !== "ready") throw new Error("Only a ready step can be executed.");

    const decision = this.policy.evaluate(request);
    if (decision.effect === "deny") {
      this.logger?.warn("plan.step.execution.denied", { runId, stepId, tool: request.tool, action: request.action, target: request.target });
      throw new PermissionDeniedError(decision.reason);
    }
    if (decision.effect === "approval_required") {
      if (!approvalId) {
        const approval = this.approvals.request(request);
        this.logger?.info("plan.step.approval.required", { runId, stepId, approvalId: approval.id, tool: request.tool, action: request.action, target: request.target });
        throw new PlanStepApprovalRequiredError(approval);
      }
      const approval = this.approvals.getById(approvalId);
      if (
        !approval ||
        approval.status !== "approved" ||
        approval.actionHash !== hashAction(request)
      ) {
        throw new PermissionDeniedError(
          "The approval is missing, not approved, already consumed, or does not match this exact action.",
        );
      }
    } else if (approvalId) {
      throw new Error("An approval ID was supplied for an action that does not require approval.");
    }

    this.runs.startStep(runId, stepId, true);
    this.logger?.info("plan.step.execution.started", { runId, stepId, tool: request.tool, action: request.action, target: request.target });
    let execution: RuntimeResult<T>;
    try {
      execution = await this.runtime.execute<T>(request, options, approvalId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown tool execution error.";
      this.logger?.error("plan.step.execution.failed", { runId, stepId, tool: request.tool, action: request.action, target: request.target, errorName: error instanceof Error ? error.name : "UnknownError" });
      const current = this.runs.getById(runId);
      if (current?.status === "running" && current.steps.find((item) => item.id === stepId)?.status === "running") {
        this.runs.failStep(runId, stepId, message.slice(0, 4_000) || "Tool execution failed.");
      }
      throw error;
    }

    const serializedOutput = JSON.stringify(execution.output === undefined ? null : execution.output) ?? "null";
    const result = serializedOutput.length > 3_900
      ? `${serializedOutput.slice(0, 3_900)}…[truncated]`
      : serializedOutput;
    const completedRun = this.runs.completeStep(runId, stepId, result, true);
    this.logger?.info("plan.step.execution.succeeded", { runId, stepId, executionId: execution.runId, durationMs: execution.durationMs });
    return { run: completedRun, execution };
  }
}
