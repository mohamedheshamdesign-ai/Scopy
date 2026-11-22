import { randomUUID } from "node:crypto";
import type { ScopyDatabase } from "../db/database.js";
import type {
  GenerateRequest,
  GenerateResponse,
  ModelProvider,
  ProviderDescriptor,
  ProviderHealth,
} from "./types.js";

export class ProviderRouter {
  private readonly providers = new Map<string, ModelProvider>();

  constructor(private readonly database: ScopyDatabase) {}

  register(provider: ModelProvider): void {
    const id = provider.descriptor.id.trim();
    if (!id) throw new Error("Provider id is required.");
    if (this.providers.has(id)) throw new Error(`Provider is already registered: ${id}`);
    this.providers.set(id, provider);
  }

  list(): ProviderDescriptor[] {
    return [...this.providers.values()].map((provider) => ({
      ...provider.descriptor,
      models: [...provider.descriptor.models],
      capabilities: { ...provider.descriptor.capabilities },
    }));
  }

  async health(providerId: string, signal?: AbortSignal): Promise<ProviderHealth> {
    const provider = this.getProvider(providerId);
    return provider.health(signal);
  }

  async generate(
    providerId: string,
    request: GenerateRequest,
    context: { readonly actorId: string; readonly purpose: string },
  ): Promise<GenerateResponse> {
    const provider = this.getProvider(providerId);
    if (!provider.descriptor.capabilities.chat) {
      throw new Error(`Provider does not support chat: ${providerId}`);
    }

    if (provider.descriptor.dataBoundary === "cloud") {
      if (request.allowCloudEgress !== true) {
        this.audit("ai.egress.blocked", providerId, context, { reason: "explicit cloud egress opt-in missing" });
        throw new Error("Cloud model use is disabled. Explicit allowCloudEgress: true is required for this request.");
      }
      this.audit("ai.egress.authorized", providerId, context, {
        model: request.model ?? provider.descriptor.models[0] ?? null,
        messageCount: request.messages.length,
      });
    }

    return provider.generate(request);
  }

  private getProvider(providerId: string): ModelProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown AI provider: ${providerId}`);
    return provider;
  }

  private audit(
    eventType: string,
    providerId: string,
    context: { readonly actorId: string; readonly purpose: string },
    payload: Record<string, unknown>,
  ): void {
    this.database.prepare(`
      INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, 'ai_provider', ?, ?, ?)
    `).run(
      randomUUID(),
      eventType,
      providerId,
      JSON.stringify({ actorId: context.actorId, purpose: context.purpose, ...payload }),
      new Date().toISOString(),
    );
  }
}
