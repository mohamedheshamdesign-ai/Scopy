import type {
  GenerateRequest,
  GenerateResponse,
  ModelProvider,
  ProviderDescriptor,
  ProviderHealth,
} from "./types.js";

export interface LocalOpenAIProviderOptions {
  readonly id?: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxContextTokens?: number;
}

function assertLoopbackUrl(input: string): URL {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (url.protocol !== "http:" || !isLoopback || url.username || url.password) {
    throw new Error("Local model endpoints must use plain HTTP on localhost or a loopback IP; credentials belong in apiKey.");
  }
  return url;
}

function normalizedBaseUrl(input: string): string {
  return assertLoopbackUrl(input).toString().replace(/\/$/, "");
}

export async function listLocalModels(
  baseUrl: string,
  apiKey?: string,
  timeoutMs = 10_000,
): Promise<string[]> {
  const normalized = normalizedBaseUrl(baseUrl);
  const response = await fetch(normalized + "/models", {
    method: "GET",
    headers: apiKey ? { authorization: "Bearer " + apiKey } : {},
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error("Local model server returned HTTP " + response.status + " while listing models.");
  }
  const payload = await response.json() as { data?: Array<{ id?: unknown }> };
  return (payload.data ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

export class LocalOpenAIProvider implements ModelProvider {
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: LocalOpenAIProviderOptions) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
    this.model = options.model.trim();
    if (!this.model) throw new Error("A local model name is required.");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    const maxContextTokens = options.maxContextTokens ?? 8_192;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 600_000) {
      throw new Error("Provider timeoutMs must be between 1 and 600000.");
    }
    if (!Number.isInteger(maxContextTokens) || maxContextTokens < 1 || maxContextTokens > 262_144) {
      throw new Error("Provider maxContextTokens must be between 1 and 262144.");
    }
    this.descriptor = Object.freeze({
      id: options.id ?? "local-openai-compatible",
      label: options.label ?? "Local OpenAI-compatible model",
      dataBoundary: "local",
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

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const models = await this.listModels(signal);
      if (!models.includes(this.model)) {
        return {
          healthy: false,
          checkedAt,
          detail: "Local server is reachable, but configured model \"" + this.model +
            "\" is not listed. Available models: " + (models.join(", ") || "(none)") + ".",
        };
      }
      return {
        healthy: true,
        checkedAt,
        detail: "Local model server is reachable and \"" + this.model + "\" is available.",
      };
    } catch (error) {
      return {
        healthy: false,
        checkedAt,
        detail: error instanceof Error ? error.message : "Local model health check failed.",
      };
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await fetch(this.baseUrl + "/models", {
      method: "GET",
      headers: this.headers(),
      signal: this.signalWithTimeout(signal),
    });
    if (!response.ok) {
      throw new Error("Local model server returned HTTP " + response.status + " while listing models.");
    }
    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    return (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    if (request.messages.length === 0) throw new Error("At least one chat message is required.");
    const model = request.model ?? this.model;
    if (!this.descriptor.models.includes(model)) {
      throw new Error("Model is not registered with provider " + this.descriptor.id + ": " + model);
    }
    const startedAt = Date.now();
    const response = await fetch(this.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: request.messages,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
        stream: false,
      }),
      signal: this.signalWithTimeout(request.signal),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      throw new Error("Local model request failed (HTTP " + response.status + "): " + detail);
    }
    const payload = await response.json() as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new Error("Local model response did not contain choices[0].message.content.");
    }
    return {
      providerId: this.descriptor.id,
      model: payload.model ?? model,
      text,
      ...(payload.usage?.prompt_tokens === undefined ? {} : { inputTokens: payload.usage.prompt_tokens }),
      ...(payload.usage?.completion_tokens === undefined ? {} : { outputTokens: payload.usage.completion_tokens }),
      durationMs: Date.now() - startedAt,
    };
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { authorization: "Bearer " + this.apiKey } : {};
  }

  private signalWithTimeout(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }
}
