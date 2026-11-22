import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /(api.?key|authorization|password|secret|token|cookie|credential|prompt|messages|content)/i;
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk-[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|hf_[A-Za-z0-9]{12,})\b/g,
];

function sanitize(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    let result = value.slice(0, 2_000);
    for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, "[REDACTED]");
    return result;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([childKey, child]) => [childKey, sanitize(child, childKey)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return value;
}

export class ScopyLogger {
  private readonly logPath: string;

  constructor(logDirectory: string, private readonly maxFileBytes = 5_000_000) {
    if (!Number.isInteger(maxFileBytes) || maxFileBytes < 256) throw new Error("Logger maxFileBytes must be at least 256.");
    mkdirSync(logDirectory, { recursive: true });
    this.logPath = join(logDirectory, "scopy.log");
  }

  debug(event: string, fields: Record<string, unknown> = {}): void { this.write("debug", event, fields); }
  info(event: string, fields: Record<string, unknown> = {}): void { this.write("info", event, fields); }
  warn(event: string, fields: Record<string, unknown> = {}): void { this.write("warn", event, fields); }
  error(event: string, fields: Record<string, unknown> = {}): void { this.write("error", event, fields); }

  private write(level: LogLevel, event: string, fields: Record<string, unknown>): void {
    if (!event.trim() || event.length > 120) throw new Error("Logger event must contain 1–120 characters.");
    const record = { timestamp: new Date().toISOString(), level, event, fields: sanitize(fields) };
    const line = JSON.stringify(record) + "\n";
    if (existsSync(this.logPath) && statSync(this.logPath).size + Buffer.byteLength(line, "utf8") > this.maxFileBytes) {
      const previous = this.logPath + ".1";
      rmSync(previous, { force: true });
      renameSync(this.logPath, previous);
    }
    appendFileSync(this.logPath, line, { encoding: "utf8", mode: 0o600 });
  }
}
