import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import type { ScopyDatabase } from "../db/database.js";
import type { ActionRequest } from "../permissions/types.js";
import { ToolGateway, type ToolExecutionContext } from "../tools/tool-gateway.js";

export type ExecutionStatus = "running" | "succeeded" | "failed" | "cancelled" | "timed_out";

export interface RuntimeOptions {
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly resumeFromRunId?: string;
  readonly onStarted?: (runId: string) => void;
}

export interface ExecutionRun<T = unknown> {
  readonly id: string;
  readonly actorId: string;
  readonly tool: string;
  readonly action: string;
  readonly target: string;
  readonly status: ExecutionStatus;
  readonly output: T | null;
  readonly error: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
}

export interface RuntimeResult<T = unknown> {
  readonly runId: string;
  readonly status: "succeeded";
  readonly output: T;
  readonly durationMs: number;
}

export class RuntimeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Execution exceeded its ${timeoutMs}ms timeout.`);
    this.name = "RuntimeTimeoutError";
  }
}

export class RuntimeCancelledError extends Error {
  constructor() {
    super("Execution was cancelled.");
    this.name = "RuntimeCancelledError";
  }
}

export class RuntimeOutputLimitError extends Error {
  constructor(limit: number, actual: number) {
    super(`Execution output is ${actual} bytes; the configured limit is ${limit} bytes.`);
    this.name = "RuntimeOutputLimitError";
  }
}

interface ActiveExecution {
  readonly controller: AbortController;
}

function serialize(value: unknown): string {
  const json = JSON.stringify(value === undefined ? null : value);
  if (json === undefined) throw new Error("Execution result could not be serialized as JSON.");
  return json;
}

export class RuntimeEngine {
  private readonly active = new Map<string, ActiveExecution>();

  constructor(
    private readonly database: ScopyDatabase,
    private readonly gateway: ToolGateway,
  ) {}

  async execute<T = unknown>(
    request: ActionRequest,
    options: RuntimeOptions = {},
    approvalId?: string,
  ): Promise<RuntimeResult<T>> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxOutputBytes = options.maxOutputBytes ?? 65_536;
    this.validateLimits(timeoutMs, maxOutputBytes);

    const runId = randomUUID();
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const requestJson = serialize(request);
    const previousCheckpoint = options.resumeFromRunId
      ? this.getLatestCheckpoint(options.resumeFromRunId)
      : null;

    this.database.prepare(`
      INSERT INTO execution_runs (
        id, actor_id, tool_name, action_name, target, request_json, status,
        timeout_ms, max_output_bytes, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
    `).run(
      runId, request.actorId, request.tool, request.action, request.target,
      requestJson, timeoutMs, maxOutputBytes, startedAt,
    );
    this.audit(runId, "runtime.execution.started", { timeoutMs, maxOutputBytes });

    const controller = new AbortController();
    this.active.set(runId, { controller });

    let timer: NodeJS.Timeout | undefined;
    let rejectAbort!: (error: Error) => void;
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    controller.signal.addEventListener("abort", () => {
      const reason = controller.signal.reason;
      rejectAbort(reason instanceof Error ? reason : new RuntimeCancelledError());
    }, { once: true });

    const context: ToolExecutionContext = {
      signal: controller.signal,
      previousCheckpoint,
      checkpoint: async (data: unknown) => {
        if (controller.signal.aborted) {
          const reason = controller.signal.reason;
          throw reason instanceof Error ? reason : new RuntimeCancelledError();
        }
        const checkpointJson = serialize(data);
        const bytes = Buffer.byteLength(checkpointJson, "utf8");
        if (bytes > maxOutputBytes) {
          throw new RuntimeOutputLimitError(maxOutputBytes, bytes);
        }
        const row = this.database.prepare(
          "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM execution_checkpoints WHERE run_id = ?",
        ).get(runId) as { sequence: number };
        this.database.prepare(`
          INSERT INTO execution_checkpoints (id, run_id, sequence, checkpoint_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(randomUUID(), runId, row.sequence + 1, checkpointJson, new Date().toISOString());
        this.audit(runId, "runtime.checkpoint.saved", { sequence: row.sequence + 1, bytes });
      },
    };

    timer = setTimeout(() => controller.abort(new RuntimeTimeoutError(timeoutMs)), timeoutMs);
    options.onStarted?.(runId);

    try {
      const work = this.gateway.execute<T>(request, approvalId, context);
      const output = await Promise.race([work, abortPromise]);
      const outputJson = serialize(output);
      const outputBytes = Buffer.byteLength(outputJson, "utf8");
      if (outputBytes > maxOutputBytes) {
        throw new RuntimeOutputLimitError(maxOutputBytes, outputBytes);
      }

      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startedAtMs;
      this.database.prepare(`
        UPDATE execution_runs
        SET status = 'succeeded', output_json = ?, finished_at = ?, duration_ms = ?
        WHERE id = ? AND status = 'running'
      `).run(outputJson, finishedAt, durationMs, runId);
      this.audit(runId, "runtime.execution.succeeded", { durationMs, outputBytes });
      return { runId, status: "succeeded", output, durationMs };
    } catch (error) {
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      const status: Exclude<ExecutionStatus, "running" | "succeeded"> =
        reason instanceof RuntimeTimeoutError ? "timed_out"
          : reason instanceof RuntimeCancelledError ? "cancelled" : "failed";
      const message = reason instanceof Error ? reason.message : "Unknown runtime error";
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startedAtMs;
      this.database.prepare(`
        UPDATE execution_runs
        SET status = ?, error_text = ?, finished_at = ?, duration_ms = ?
        WHERE id = ? AND status = 'running'
      `).run(status, message, finishedAt, durationMs, runId);
      this.audit(runId, `runtime.execution.${status}`, { durationMs, error: message });
      throw reason instanceof Error ? reason : error;
    } finally {
      if (timer) clearTimeout(timer);
      this.active.delete(runId);
    }
  }

  cancel(runId: string): boolean {
    const execution = this.active.get(runId);
    if (!execution || execution.controller.signal.aborted) return false;
    execution.controller.abort(new RuntimeCancelledError());
    return true;
  }

  getRun<T = unknown>(runId: string): ExecutionRun<T> | undefined {
    const row = this.database.prepare(`
      SELECT id, actor_id, tool_name, action_name, target, status, output_json,
             error_text, started_at, finished_at, duration_ms
      FROM execution_runs WHERE id = ?
    `).get(runId) as {
      id: string; actor_id: string; tool_name: string; action_name: string; target: string;
      status: ExecutionStatus; output_json: string | null; error_text: string | null;
      started_at: string; finished_at: string | null; duration_ms: number | null;
    } | undefined;
    if (!row) return undefined;
    return {
      id: row.id, actorId: row.actor_id, tool: row.tool_name, action: row.action_name,
      target: row.target, status: row.status,
      output: row.output_json === null ? null : JSON.parse(row.output_json) as T,
      error: row.error_text, startedAt: row.started_at, finishedAt: row.finished_at,
      durationMs: row.duration_ms,
    };
  }

  getLatestCheckpoint(runId: string): unknown | null {
    const row = this.database.prepare(`
      SELECT checkpoint_json FROM execution_checkpoints
      WHERE run_id = ? ORDER BY sequence DESC LIMIT 1
    `).get(runId) as { checkpoint_json: string } | undefined;
    return row ? JSON.parse(row.checkpoint_json) as unknown : null;
  }

  private validateLimits(timeoutMs: number, maxOutputBytes: number): void {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
      throw new Error("timeoutMs must be an integer between 1 and 600000.");
    }
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 1_048_576) {
      throw new Error("maxOutputBytes must be an integer between 1 and 1048576.");
    }
  }

  private audit(runId: string, eventType: string, payload: Record<string, unknown>): void {
    this.database.prepare(`
      INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, 'execution_run', ?, ?, ?)
    `).run(randomUUID(), eventType, runId, JSON.stringify(payload), new Date().toISOString());
  }
}
