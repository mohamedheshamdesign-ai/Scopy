export type MessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  readonly role: MessageRole;
  readonly content: string;
}

export interface ModelCapabilities {
  readonly chat: boolean;
  readonly streaming: boolean;
  readonly tools: boolean;
  readonly vision: boolean;
  readonly maxContextTokens: number;
}

export interface ProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly dataBoundary: "local" | "cloud";
  readonly models: readonly string[];
  readonly capabilities: ModelCapabilities;
}

export interface GenerateRequest {
  readonly messages: readonly ChatMessage[];
  readonly model?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
  readonly allowCloudEgress?: boolean;
}

export interface GenerateResponse {
  readonly providerId: string;
  readonly model: string;
  readonly text: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly durationMs: number;
}

export interface ProviderHealth {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly detail: string;
}

export interface ModelProvider {
  readonly descriptor: ProviderDescriptor;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}
