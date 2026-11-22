import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ActionRequest } from "../permissions/types.js";
import type { ToolExecutionContext } from "./tool-gateway.js";
import { ToolGateway } from "./tool-gateway.js";

const COMMANDS: Readonly<Record<string, { readonly program: string; readonly args: readonly string[]; readonly windowsCommand?: string }>> = Object.freeze({
  "git-status": { program: "git", args: ["status", "--short"] },
  "git-diff": { program: "git", args: ["diff", "--stat"] },
  "git-log": { program: "git", args: ["log", "-5", "--oneline"] },
  "node-version": { program: "node", args: ["--version"] },
  "npm-check": { program: "npm", args: ["run", "check"], windowsCommand: "npm run check" },
  "npm-build": { program: "npm", args: ["run", "build"], windowsCommand: "npm run build" },
  "npm-test": { program: "npm", args: ["test"], windowsCommand: "npm test" },
});

export interface TerminalToolOptions {
  readonly workspaceRoot: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

interface TerminalPayload { readonly commandId?: string; readonly executable?: string; readonly args?: readonly string[]; readonly timeoutMs?: number; }

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const names = ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"];
  const env: NodeJS.ProcessEnv = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export class TerminalTool {
  private readonly root: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: TerminalToolOptions) {
    this.root = resolve(options.workspaceRoot);
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 128_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) throw new Error("Terminal timeout must be 1–120000ms.");
    if (!Number.isInteger(this.maxOutputBytes) || this.maxOutputBytes < 1024 || this.maxOutputBytes > 256_000) throw new Error("Terminal output limit must be 1024–256000 bytes.");
  }

  register(gateway: ToolGateway): void {
    gateway.register("terminal", "Run a small fixed set of diagnostic and project verification commands inside the configured Scopy workspace; arbitrary commands and shell strings are not accepted.", (request, context) => this.handle(request, context));
  }

  private async handle(request: ActionRequest, context?: ToolExecutionContext): Promise<unknown> {
    if (request.action !== "run") throw new Error("Terminal supports only the run action.");
    const payload = request.payload as TerminalPayload | undefined;
    if (!payload) throw new Error("Terminal command payload is required.");
    let commandId = payload.commandId;
    if (!commandId && typeof payload.executable === "string" && Array.isArray(payload.args)) {
      commandId = Object.keys(COMMANDS).find(id => COMMANDS[id]!.program === payload.executable &&
        COMMANDS[id]!.args.length === payload.args!.length &&
        COMMANDS[id]!.args.every((arg, index) => arg === payload.args![index]));
    }
    if (typeof commandId !== "string" || !Object.hasOwn(COMMANDS, commandId)) throw new Error("Terminal command is not in the fixed allowlist.");
    const command = COMMANDS[commandId]!;
    const commandTimeoutMs = payload.timeoutMs ?? this.timeoutMs;
    if (!Number.isInteger(commandTimeoutMs) || commandTimeoutMs < 1000 || commandTimeoutMs > 120000) throw new Error("Terminal command timeout must be between 1000 and 120000ms.");
    const cwd = resolve(this.root, request.target || ".");
    const actualRoot = await realpath(this.root);
    const actualCwd = await realpath(cwd);
    if (!within(actualRoot, actualCwd)) throw new Error("Terminal working directory is outside the configured workspace.");

    let executable = command.program;
    let args = [...command.args];
    if (process.platform === "win32" && command.windowsCommand) {
      executable = process.env.ComSpec || "cmd.exe";
      args = ["/d", "/s", "/c", command.windowsCommand];
    }

    return new Promise((resolveResult, rejectResult) => {
      const child = spawn(executable, args, {
        cwd: actualCwd,
        env: safeEnvironment(),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (error?: Error, result?: unknown) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        context?.signal.removeEventListener("abort", onAbort);
        if (error) rejectResult(error);
        else resolveResult(result);
      };
      const append = (target: "stdout" | "stderr", chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > this.maxOutputBytes) {
          child.kill();
          finish(new Error("Terminal output exceeded the configured limit."));
          return;
        }
        if (target === "stdout") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };
      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.once("error", error => finish(error));
      child.once("close", code => {
        if (code !== 0) {
          finish(new Error("Command exited with code " + String(code) + (stderr.trim() ? ": " + stderr.trim().slice(0, 2000) : "")));
          return;
        }
        finish(undefined, {
          commandId,
          exitCode: code,
          stdout: stdout.slice(0, this.maxOutputBytes),
          stderr: stderr.slice(0, this.maxOutputBytes),
          workingDirectory: actualCwd,
        });
      });
      const onAbort = () => {
        child.kill();
        finish(context?.signal.reason instanceof Error ? context.signal.reason : new Error("Terminal command cancelled."));
      };
      if (context?.signal.aborted) onAbort();
      else context?.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        child.kill();
        finish(new Error("Terminal command timed out after " + this.timeoutMs + "ms."));
      }, commandTimeoutMs);
    });
  }
}

export const TERMINAL_COMMAND_IDS = Object.freeze(Object.keys(COMMANDS));
