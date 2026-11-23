import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type {
  GenerateRequest,
  GenerateResponse,
  ModelProvider,
  ProviderDescriptor,
  ProviderHealth,
} from "./types.js";

/**
 * One egress call the provider wants to make. Transport is injectable so
 * offline contract tests can assert the exact wire protocol without network.
 */
export interface CloudTransportRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface CloudTransportResponse {
  readonly status: number;
  readonly body: string;
}

export type CloudTransport = (request: CloudTransportRequest) => Promise<CloudTransportResponse>;

export type DnsLookup = (hostname: string) => Promise<Array<{ address: string; family?: number }>>;

export interface CloudOpenAIProviderOptions {
  readonly id?: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly maxContextTokens?: number;
  /** Tests/advanced only: replaces the pinned HTTPS transport entirely. */
  readonly transport?: CloudTransport;
  /** Tests/advanced only: DNS resolver used by the default pinned transport. */
  readonly lookupFn?: DnsLookup;
}

/**
 * Reviewed cloud provider hosts whose wire protocol this adapter actually
 * implements (OpenAI Chat Completions: POST {baseUrl}/chat/completions with a
 * Bearer key). Exactly one today. An allowlist entry alone does NOT make a
 * working integration: adding a host is a deliberate code change that must
 * ship with offline contract tests for that provider's protocol.
 */
export const REVIEWED_CLOUD_HOSTS: readonly string[] = [
  "api.openai.com",
];

export function isPublicCloudAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const a = parts[0] ?? 0; const b = parts[1] ?? 0;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 203 && b === 0));
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    // IPv4-mapped or translated addresses: refuse outright, the embedded IPv4
    // policy cannot be trusted through translation on this egress path.
    if (value.startsWith("::ffff:") || value.startsWith("64:ff9b::")) return false;
    // Multicast, documentation, discard, and benchmark ranges.
    if (value.startsWith("ff") || value.startsWith("2001:db8:") || value === "100::" || value.startsWith("100::")) return false;
    // Unspecified, loopback, unique-local, link-local.
    return !(value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
      value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb"));
  }
  return false;
}

function assertPublicHttpsUrl(input: string): URL {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || host === "localhost" || url.username || url.password) {
    throw new Error("Cloud model endpoints must use HTTPS on a public host without embedded credentials; credentials belong in apiKey.");
  }
  if (isIP(host) !== 0) {
    throw new Error("Cloud model endpoints must name a reviewed provider host, not a literal IP.");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new Error("Cloud model endpoints must use the default HTTPS port 443; explicit non-standard ports are refused.");
  }
  if (!REVIEWED_CLOUD_HOSTS.includes(host)) {
    throw new Error("Cloud model endpoint host is not in the reviewed provider list (REVIEWED_CLOUD_HOSTS); adding a provider is a deliberate code change.");
  }
  return url;
}

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Connection-bound transport: DNS is resolved and validated inside the
 * connection's own lookup callback, so the address the TLS connection
 * actually dials is exactly the validated address. There is no separate
 * resolution step for fetch to repeat, which closes the DNS-rebinding gap
 * between "checked hostname" and "connected address". Connections are
 * restricted to reviewed public IPv4 addresses; redirects are never followed
 * (node:https does not follow them) so the Bearer key can only leave the
 * process to the reviewed host.
 */
function createPinnedHttpsTransport(hostname: string, lookupFn: DnsLookup): CloudTransport {
  return (req) => new Promise<CloudTransportResponse>((resolve, reject) => {
    const request = httpsRequest({
      hostname,
      port: 443,
      servername: hostname,
      path: req.path,
      method: req.method,
      headers: req.headers,
      signal: req.signal,
      lookup: (_host, _options, callback) => {
        lookupFn(hostname).then((entries) => {
          const usable = entries.filter((entry) => isIP(entry.address) === 4 && isPublicCloudAddress(entry.address));
          if (usable.length === 0) {
            callback(new Error("Cloud model endpoint did not resolve to a reviewed public IPv4 address."), "", 4);
            return;
          }
          callback(null, usable[0]!.address, 4);
        }, (error: unknown) => {
          callback(error instanceof Error ? error : new Error("Cloud model endpoint DNS resolution failed."), "", 4);
        });
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new Error("Cloud model server response exceeded the 4 MiB limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
      });
      response.on("error", reject);
    });
    request.setTimeout(req.timeoutMs, () => {
      request.destroy(new Error("Cloud model request timed out."));
    });
    request.on("error", reject);
    if (req.body !== undefined) request.write(req.body);
    request.end();
  });
}

/**
 * Optional cloud provider preparation. This provider is only registered when
 * SCOPY_CLOUD_AI_URL, SCOPY_CLOUD_AI_MODEL, and SCOPY_CLOUD_API_KEY are all set
 * for the current process, and every request still requires the per-request
 * allowCloudEgress: true opt-in enforced (and audited) by ProviderRouter.
 * Disabled entirely by default: no registration, no key storage, no traffic.
 */
export class CloudOpenAIProvider implements ModelProvider {
  readonly descriptor: ProviderDescriptor;
  private readonly basePath: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly transport: CloudTransport;

  constructor(options: CloudOpenAIProviderOptions) {
    const url = assertPublicHttpsUrl(options.baseUrl);
    this.basePath = url.pathname.replace(/\/$/, "");
    this.model = options.model.trim();
    if (!this.model) throw new Error("A cloud model name is required.");
    const lookupFn: DnsLookup = options.lookupFn ?? ((hostname) => lookup(hostname, { all: true, verbatim: true }));
    this.transport = options.transport ?? createPinnedHttpsTransport(url.hostname.toLowerCase(), lookupFn);
    this.apiKey = options.apiKey.trim();
    if (!this.apiKey) throw new Error("A cloud API key is required; provide it via the SCOPY_CLOUD_API_KEY environment variable only.");
    this.timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 600_000) {
      throw new Error("Provider timeoutMs must be between 1 and 600000.");
    }
    const maxContextTokens = options.maxContextTokens ?? 8_192;
    if (!Number.isInteger(maxContextTokens) || maxContextTokens < 1 || maxContextTokens > 262_144) {
      throw new Error("Provider maxContextTokens must be between 1 and 262144.");
    }
    this.descriptor = Object.freeze({
      id: options.id ?? "cloud-openai-compatible",
      label: options.label ?? "Cloud OpenAI-compatible model (explicit opt-in)",
      dataBoundary: "cloud",
      models: [this.model],
      capabilities: {
        chat: true,
        streaming: false,
        tools: false,
        vision: false,
        maxContextTokens,
      },
    });
  }

  private headers(): Record<string, string> {
    return { authorization: "Bearer " + this.apiKey };
  }

  private signalWithTimeout(signal?: AbortSignal): AbortSignal {
    if (signal) return AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    return AbortSignal.timeout(this.timeoutMs);
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await this.transport({
        method: "GET",
        path: this.basePath + "/models",
        headers: this.headers(),
        timeoutMs: this.timeoutMs,
        signal: this.signalWithTimeout(signal),
      });
      if (response.status < 200 || response.status >= 300) {
        return { healthy: false, checkedAt, detail: "Cloud model server returned HTTP " + response.status + " while listing models." };
      }
      return { healthy: true, checkedAt, detail: "Cloud endpoint is reachable (explicit opt-in provider)." };
    } catch (error) {
      return { healthy: false, checkedAt, detail: error instanceof Error ? error.message : "Cloud model health check failed." };
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    if (request.messages.length === 0) throw new Error("At least one chat message is required.");
    const model = request.model ?? this.model;
    if (!this.descriptor.models.includes(model)) {
      throw new Error("Model is not registered with provider " + this.descriptor.id + ": " + model);
    }
    const startedAt = Date.now();
    const response = await this.transport({
      method: "POST",
      path: this.basePath + "/chat/completions",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: request.messages,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
      }),
      timeoutMs: this.timeoutMs,
      signal: this.signalWithTimeout(request.signal),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error("Cloud model server returned HTTP " + response.status + " while generating.");
    }
    const payload = JSON.parse(response.body) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0) {
      throw new Error("Cloud model server returned an empty completion.");
    }
    return {
      providerId: this.descriptor.id,
      model,
      text,
      ...(payload.usage?.prompt_tokens !== undefined ? { inputTokens: payload.usage.prompt_tokens } : {}),
      ...(payload.usage?.completion_tokens !== undefined ? { outputTokens: payload.usage.completion_tokens } : {}),
      durationMs: Date.now() - startedAt,
    };
  }
}
