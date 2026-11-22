import type { ActionRequest } from "../permissions/types.js";
import { ExecutionGuard } from "../permissions/execution-guard.js";

export interface ToolExecutionContext {
  readonly signal: AbortSignal;
  readonly previousCheckpoint: unknown | null;
  checkpoint(data: unknown): Promise<void>;
}

export type ToolHandler = (
  request: ActionRequest,
  context?: ToolExecutionContext,
) => unknown | Promise<unknown>;

export interface RegisteredTool {
  readonly name: string;
  readonly description: string;
}

export class ToolGateway {
  private readonly handlers = new Map<string, ToolHandler>();
  private readonly descriptions = new Map<string, string>();

  constructor(private readonly guard: ExecutionGuard) {}

  register(name: string, description: string, handler: ToolHandler): void {
    const normalizedName = name.trim();
    if (!normalizedName || !description.trim()) {
      throw new Error("Tool name and description are required.");
    }
    if (this.handlers.has(normalizedName)) {
      throw new Error(`Tool is already registered: ${normalizedName}`);
    }
    this.handlers.set(normalizedName, handler);
    this.descriptions.set(normalizedName, description.trim());
  }

  list(): RegisteredTool[] {
    return [...this.handlers.keys()].sort().map((name) => ({
      name,
      description: this.descriptions.get(name)!,
    }));
  }

  async execute<T = unknown>(
    request: ActionRequest,
    approvalId?: string,
    context?: ToolExecutionContext,
  ): Promise<T> {
    const handler = this.handlers.get(request.tool);
    if (!handler) throw new Error(`Unknown tool: ${request.tool}`);
    return this.guard.execute(
      request,
      () => handler(request, context) as T | Promise<T>,
      approvalId,
    );
  }
}
