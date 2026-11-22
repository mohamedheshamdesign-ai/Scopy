import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ActionRequest } from "../permissions/types.js";
import { ToolGateway } from "./tool-gateway.js";

export interface FilesystemToolOptions {
  readonly workspaceRoot: string;
}

export interface FilesystemWritePayload {
  readonly content: string;
}

export class FilesystemSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilesystemSandboxError";
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function realPathOrNearestExisting(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    const parent = dirname(path);
    if (parent === path) throw error;
    const resolvedParent = await realPathOrNearestExisting(parent);
    return resolve(resolvedParent, path.slice(parent.length + 1));
  }
}

export class FilesystemTool {
  private readonly rootPromise: Promise<string>;

  constructor(options: FilesystemToolOptions) {
    this.rootPromise = this.initialize(options.workspaceRoot);
  }

  register(gateway: ToolGateway): void {
    gateway.register(
      "filesystem",
      "Read and write UTF-8 text files inside the configured Scopy workspace.",
      (request) => this.handle(request),
    );
  }

  private async initialize(root: string): Promise<string> {
    await mkdir(root, { recursive: true });
    return realpath(root);
  }

  private async resolveSafePath(input: string): Promise<{ root: string; path: string }> {
    const root = await this.rootPromise;
    const requested = isAbsolute(input) ? resolve(input) : resolve(root, input);
    const resolved = await realPathOrNearestExisting(requested);
    if (!isWithinRoot(root, resolved)) {
      throw new FilesystemSandboxError("Path is outside the configured Scopy workspace.");
    }
    return { root, path: requested };
  }

  private async handle(request: ActionRequest): Promise<string | { bytesWritten: number }> {
    if (request.action !== "read" && request.action !== "write") {
      throw new Error(`Unsupported filesystem action: ${request.action}`);
    }
    if (!request.target.trim()) throw new Error("A filesystem target path is required.");

    const { root, path } = await this.resolveSafePath(request.target);

    if (request.action === "read") {
      const actual = await realpath(path);
      if (!isWithinRoot(root, actual)) {
        throw new FilesystemSandboxError("Resolved file is outside the configured Scopy workspace.");
      }
      return readFile(actual, "utf8");
    }

    const payload = request.payload as FilesystemWritePayload | undefined;
    if (!payload || typeof payload.content !== "string") {
      throw new Error("Filesystem write requires a string payload.content.");
    }

    await mkdir(dirname(path), { recursive: true });
    const parent = await realpath(dirname(path));
    if (!isWithinRoot(root, parent)) {
      throw new FilesystemSandboxError("Write destination is outside the configured Scopy workspace.");
    }

    try {
      const existing = await realpath(path);
      if (!isWithinRoot(root, existing)) {
        throw new FilesystemSandboxError("Write destination resolves outside the configured Scopy workspace.");
      }
    } catch (error) {
      if (error instanceof FilesystemSandboxError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }

    await writeFile(path, payload.content, { encoding: "utf8", flag: "w" });
    return { bytesWritten: Buffer.byteLength(payload.content, "utf8") };
  }
}
