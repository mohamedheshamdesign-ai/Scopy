import type { ApprovalRequest, ActionRequest } from "../permissions/types.js";
import { ApprovalService, hashAction } from "../permissions/approval-service.js";
import { ApprovalRequiredError, ExecutionGuard, PermissionDeniedError } from "../permissions/execution-guard.js";
import type { PolicyEngine } from "../permissions/policy-engine.js";
import type { RuntimeOptions, RuntimeResult } from "../runtime/runtime-engine.js";
import { RuntimeEngine } from "../runtime/runtime-engine.js";
import { PlanRunRepository, type PlanRun } from "./run-repository.js";

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
  ) {}

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
      throw new PermissionDeniedError(decision.reason);
    }
    if (decision.effect === "approval_required") {
      if (!approvalId) {
        throw new PlanStepApprovalRequiredError(this.approvals.request(request));
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

    this.runs.startStep(runId, stepId);
    let execution: RuntimeResult<T>;
    try {
      execution = await this.runtime.execute<T>(request, options, approvalId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown tool execution error.";
      const current = this.runs.getById(runId);
      if (current?.status === "running" && current.steps.find((item) => item.id === stepId)?.status === "running") {
        this.runs.failStep(runId, stepId, message.slice(0, 4_000) || "Tool execution failed.");
      }
      throw error;
    }

    const serializedOutput = JSON.stringify(execution.output === undefined ? null : execution.output);
    const result = serializedOutput.length > 3_900
      ? `${serializedOutput.slice(0, 3_900)}…[truncated]`
      : serializedOutput;
    return {
      run: this.runs.completeStep(runId, stepId, result),
      execution,
    };
  }
}
