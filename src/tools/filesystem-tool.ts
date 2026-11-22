import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ActionRequest } from "../permissions/types.js";
import { ToolGateway } from "./tool-gateway.js";

export interface FilesystemToolOptions {
  readonly workspaceRoot: string;
}

export const MAX_FILE_BYTES = 1_048_576;

interface FilesystemWritePayload {
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
  private readonly workspaceRoot: string;
  private rootPromise: Promise<string> | undefined;

  constructor(options: FilesystemToolOptions) {
    this.workspaceRoot = options.workspaceRoot;
  }

  register(gateway: ToolGateway): void {
    gateway.register(
      "filesystem",
      "Read and write UTF-8 text files inside the configured Scopy workspace.",
      (request) => this.handle(request),
    );
  }

  private getRoot(): Promise<string> {
    // Initialize lazily: a denied or never-invoked tool must not start background
    // filesystem work that can outlive its caller (for example, a test fixture).
    this.rootPromise ??= this.initialize(this.workspaceRoot);
    return this.rootPromise;
  }

  private async initialize(root: string): Promise<string> {
    await mkdir(root, { recursive: true });
    return realpath(root);
  }

  private async resolveSafePath(input: string): Promise<{ root: string; path: string }> {
    const root = await this.getRoot();
    const requested = isAbsolute(input) ? resolve(input) : resolve(root, input);
    const resolved = await realPathOrNearestExisting(requested);
    if (!isWithinRoot(root, resolved)) {
      throw new FilesystemSandboxError("Path is outside the configured Scopy workspace.");
    }
    return { root, path: requested };
  }

  private async handle(request: ActionRequest): Promise<unknown> {
    if (request.action !== "read" && request.action !== "write" && request.action !== "list" && request.action !== "mkdir") {
      throw new Error(`Unsupported filesystem action: ${request.action}`);
    }
    if (!request.target.trim()) throw new Error("A filesystem target path is required.");

    const { root, path } = await this.resolveSafePath(request.target);

    if (request.action === "read") {
      const actual = await realpath(path);
      if (!isWithinRoot(root, actual)) {
        throw new FilesystemSandboxError("Resolved file is outside the configured Scopy workspace.");
      }
      const fileInfo = await stat(actual);
      if (!fileInfo.isFile()) throw new FilesystemSandboxError("Only regular files can be read.");
      if (fileInfo.size > MAX_FILE_BYTES) throw new FilesystemSandboxError("File exceeds the 1 MiB read limit.");
      return readFile(actual, "utf8");
    }

    if (request.action === "list") {
      const actual = await realpath(path);
      if (!isWithinRoot(root, actual)) {
        throw new FilesystemSandboxError("Directory is outside the configured Scopy workspace.");
      }
      const entries = (await readdir(actual, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
      const visible = entries.slice(0, 500).map((entry) => ({
        name: entry.name,
        type: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      }));
      return { entries: visible, truncated: entries.length > visible.length };
    }

    if (request.action === "mkdir") {
      await mkdir(path, { recursive: true });
      const actual = await realpath(path);
      if (!isWithinRoot(root, actual)) {
        throw new FilesystemSandboxError("Created directory resolves outside the configured Scopy workspace.");
      }
      return { created: true };
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
