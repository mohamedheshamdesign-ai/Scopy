import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ActionRequest } from "../permissions/types.js";
import { ToolGateway, type ToolExecutionContext } from "./tool-gateway.js";

const ALLOWED_EXECUTABLES = new Set([
  "node", "node.exe", "git", "git.exe", "python", "python.exe", "powershell.exe",
]);
const MAX_OUTPUT_BYTES = 64 * 1024;

interface TerminalPayload {
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

function validatePayload(value: unknown): TerminalPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Terminal execution requires an object payload.");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["executable", "args", "timeoutMs"].includes(key))) {
    throw new Error("Terminal payload contains unsupported fields.");
  }
  if (typeof input.executable !== "string" || !ALLOWED_EXECUTABLES.has(input.executable.toLowerCase())) {
    throw new Error("Executable must be one of: node, git, python, powershell.exe.");
  }
  if (!Array.isArray(input.args) || input.args.length > 100 ||
      !input.args.every((arg) => typeof arg === "string" && arg.length <= 4096 && !arg.includes("\0"))) {
    throw new Error("Terminal args must be an array of at most 100 strings (4096 characters each).");
  }
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
    throw new Error("Terminal timeoutMs must be between 1000 and 120000.");
  }
  return { executable: input.executable, args: input.args as string[], timeoutMs };
}

export class TerminalTool {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  register(gateway: ToolGateway): void {
    gateway.register(
      "terminal",
      "Run an explicitly approved process without a shell, inside the configured Scopy workspace, with bounded time and output.",
      (request, context) => this.handle(request, context),
    );
  }

  private async handle(request: ActionRequest, context?: ToolExecutionContext): Promise<unknown> {
    if (request.action !== "run") throw new Error("Terminal supports only the run action.");
    const payload = validatePayload(request.payload);
    const root = await realpath(this.workspaceRoot);
    const requested = isAbsolute(request.target) ? resolve(request.target) : resolve(root, request.target);
    const cwd = await realpath(requested);
    if (!within(root, cwd)) throw new Error("Terminal working directory is outside the configured Scopy workspace.");
    if (!(await stat(cwd)).isDirectory()) throw new Error("Terminal working directory must be a directory.");
    if (context?.signal.aborted) throw context.signal.reason instanceof Error ? context.signal.reason : new Error("Terminal action cancelled.");

    const startedAt = Date.now();
    return await new Promise((resolveResult, rejectResult) => {
      const child = spawn(payload.executable, [...payload.args], {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let settled = false;
      let timedOut = false;
      const finish = (error?: Error, result?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context?.signal.removeEventListener("abort", onAbort);
        if (error) rejectResult(error);
        else resolveResult(result);
      };
      const onAbort = (): void => {
        child.kill();
        const reason = context?.signal.reason;
        finish(reason instanceof Error ? reason : new Error("Terminal action cancelled."));
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, payload.timeoutMs);
      context?.signal.addEventListener("abort", onAbort, { once: true });
      const collect = (chunk: Buffer, stream: "stdout" | "stderr"): void => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_OUTPUT_BYTES) {
          child.kill();
          finish(new Error("Terminal output exceeded the 64 KiB limit."));
          return;
        }
        if (stream === "stdout") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };
      child.stdout?.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
      child.stderr?.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
      child.once("error", (error) => finish(error));
      child.once("close", (code, signal) => {
        if (timedOut) {
          finish(new Error("Terminal command exceeded its " + payload.timeoutMs + "ms timeout."));
          return;
        }
        if (context?.signal.aborted) {
          const reason = context.signal.reason;
          finish(reason instanceof Error ? reason : new Error("Terminal action cancelled."));
          return;
        }
        finish(undefined, {
          executable: payload.executable,
          args: payload.args,
          workingDirectory: cwd,
          exitCode: code,
          signal,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}
