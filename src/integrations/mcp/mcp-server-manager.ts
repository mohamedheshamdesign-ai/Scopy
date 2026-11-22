import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface McpServerDefinition {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly passEnv: readonly string[];
  readonly timeoutMs: number;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly annotations?: unknown;
}

interface RpcResponse {
  readonly jsonrpc?: string;
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code?: number; readonly message?: string };
}

interface McpSession {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: ReadLineInterface;
  readonly pending: Map<number, { resolve: (value: RpcResponse) => void; reject: (error: Error) => void }>;
  request(method: string, params?: Record<string, unknown>): Promise<RpcResponse>;
  notify(method: string, params?: Record<string, unknown>): void;
  close(): Promise<void>;
}

const ALLOWED_COMMANDS = new Set(["node", "node.exe", "python", "python.exe", "powershell.exe"]);
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_RPC_BYTES = 1024 * 1024;

function validateServer(value: unknown): McpServerDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("MCP server definition must be an object.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["id", "command", "args", "passEnv", "timeoutMs"].includes(key))) {
    throw new Error("MCP server definition contains unsupported fields.");
  }
  if (typeof input.id !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(input.id)) {
    throw new Error("MCP server ID must be 2–40 lowercase letters, numbers, or hyphens.");
  }
  if (typeof input.command !== "string" || !ALLOWED_COMMANDS.has(input.command.toLowerCase())) {
    throw new Error("MCP command must be node, python, or powershell.exe.");
  }
  if (!Array.isArray(input.args) || input.args.length > 100 ||
      !input.args.every((arg) => typeof arg === "string" && arg.length <= 4096 && !arg.includes("\0"))) {
    throw new Error("MCP args must contain at most 100 bounded strings.");
  }
  if (!Array.isArray(input.passEnv) || input.passEnv.length > 50 ||
      !input.passEnv.every((key) => typeof key === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) {
    throw new Error("MCP passEnv must contain valid environment variable names.");
  }
  const timeoutMs = input.timeoutMs ?? 30000;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new Error("MCP timeoutMs must be between 1000 and 120000.");
  }
  return {
    id: input.id,
    command: input.command,
    args: input.args as string[],
    passEnv: [...new Set(input.passEnv as string[])],
    timeoutMs,
  };
}

function makeSession(child: ChildProcessWithoutNullStreams, timeoutMs: number): McpSession {
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, { resolve: (value: RpcResponse) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let closed = false;
  const failAll = (error: Error): void => {
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  };
  lines.on("line", (line) => {
    if (Buffer.byteLength(line, "utf8") > MAX_RPC_BYTES) {
      failAll(new Error("MCP server response exceeded the 1 MiB limit."));
      child.kill();
      return;
    }
    let message: RpcResponse;
    try {
      message = JSON.parse(line) as RpcResponse;
    } catch {
      failAll(new Error("MCP server wrote invalid JSON to stdout; protocol messages must be newline-delimited JSON."));
      child.kill();
      return;
    }
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error("MCP error " + message.error.code + ": " + (message.error.message ?? "unknown error")));
    else waiter.resolve(message);
  });
  child.once("error", (error) => failAll(error));
  child.once("exit", (code, signal) => failAll(new Error("MCP server exited (code=" + code + ", signal=" + signal + ").")));

  return {
    child,
    lines,
    pending,
    request(method, params = {}) {
      if (closed || child.exitCode !== null) return Promise.reject(new Error("MCP server process is not running."));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("MCP request timed out: " + method));
          child.kill();
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n", (error) => {
          if (error) {
            pending.delete(id);
            clearTimeout(timer);
            reject(error);
          }
        });
      });
    },
    notify(method, params = {}) {
      if (closed || child.exitCode !== null) throw new Error("MCP server process is not running.");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    },
    async close() {
      if (closed) return;
      closed = true;
      lines.close();
      failAll(new Error("MCP session closed."));
      if (child.exitCode === null) {
        child.kill();
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null) resolve();
          else child.once("close", () => resolve());
        });
      }
    },
  };
}

export class McpServerManager {
  private readonly configPath: string;

  constructor(private readonly homeDirectory: string) {
    this.configPath = join(homeDirectory, "secrets", "mcp-servers.json");
  }

  async list(): Promise<McpServerDefinition[]> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) throw new Error("MCP server configuration exceeds 256 KiB.");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("MCP server configuration must be a JSON array.");
      return parsed.map(validateServer);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async add(input: unknown): Promise<McpServerDefinition> {
    const server = validateServer(input);
    const servers = await this.list();
    if (servers.some((item) => item.id === server.id)) throw new Error("MCP server ID already exists: " + server.id);
    await this.save([...servers, server]);
    return server;
  }

  async remove(id: string): Promise<boolean> {
    const servers = await this.list();
    const next = servers.filter((item) => item.id !== id);
    if (next.length === servers.length) return false;
    await this.save(next);
    return true;
  }

  async listTools(serverId: string): Promise<McpToolDefinition[]> {
    return this.withSession(serverId, async (session) => {
      const response = await session.request("tools/list");
      const tools = response.result?.tools;
      if (!Array.isArray(tools)) throw new Error("MCP server returned an invalid tools/list response.");
      return tools.map((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item) ||
            typeof (item as Record<string, unknown>).name !== "string") {
          throw new Error("MCP server returned a malformed tool definition.");
        }
        return item as McpToolDefinition;
      });
    });
  }

  async callTool(serverId: string, toolName: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (!toolName.trim() || toolName.length > 128) throw new Error("MCP tool name is invalid.");
    return this.withSession(serverId, async (session) => {
      const listed = await session.request("tools/list");
      const tools = listed.result?.tools;
      if (!Array.isArray(tools) || !tools.some((item) =>
        typeof item === "object" && item !== null && (item as Record<string, unknown>).name === toolName)) {
        throw new Error("MCP tool is not exposed by the selected server: " + toolName);
      }
      const response = await session.request("tools/call", { name: toolName, arguments: args });
      const result = response.result ?? {};
      const serialized = JSON.stringify(result);
      if (serialized && Buffer.byteLength(serialized, "utf8") > MAX_RPC_BYTES) {
        throw new Error("MCP tool output exceeded the 1 MiB limit.");
      }
      if (result.isError === true) throw new Error("MCP tool returned an error: " + serialized);
      return result;
    });
  }

  private async withSession<T>(serverId: string, operation: (session: McpSession) => Promise<T>): Promise<T> {
    const server = (await this.list()).find((item) => item.id === serverId);
    if (!server) throw new Error("MCP server is not configured: " + serverId);
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "TMPDIR"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    env.SCOPY_HOME = this.homeDirectory;
    for (const key of server.passEnv) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    const child = spawn(server.command, [...server.args], {
      cwd: this.homeDirectory,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.resume();
    const session = makeSession(child, server.timeoutMs);
    try {
      const initialized = await session.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "Scopy", version: "0.1.0" },
      });
      if (!initialized.result) throw new Error("MCP server did not complete initialization.");
      session.notify("notifications/initialized");
      return await operation(session);
    } finally {
      await session.close();
    }
  }

  private async save(servers: readonly McpServerDefinition[]): Promise<void> {
    const directory = join(this.homeDirectory, "secrets");
    await mkdir(directory, { recursive: true });
    const temporary = this.configPath + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(servers, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, this.configPath);
  }
}
