/**
 * Generic webhook provider adapter.
 * Receives inbound webhook payloads pushed to a per-project endpoint.
 * Items are normalized from a flexible JSON schema.
 */

import type { IntegrationConnection } from "@opensprint/shared";
import type {
  IntegrationAdapter,
  AdapterCapabilities,
  RawExternalItem,
  NormalizedIntakeItem,
} from "../integration-adapter.js";
import { adapterRegistry } from "../integration-adapter.js";

/** Expected shape of an inbound webhook payload item. */
export interface WebhookPayloadItem {
  id: string;
  title?: string;
  summary?: string;
  body?: string;
  description?: string;
  author?: string;
  labels?: string[];
  tags?: string[];
  created_at?: string;
  url?: string;
  source?: string;
}

export class WebhookAdapter implements IntegrationAdapter {
  readonly provider = "webhook" as const;
  readonly capabilities: AdapterCapabilities = {
    supportsOAuth: false,
    supportsPoll: false,
    supportsWebhook: true,
    supportsSourceSelection: false,
    supportsDelete: false,
  };

  /**
   * Webhook adapter does not poll — items are pushed via the webhook endpoint.
   * This method returns an empty array; items arrive through ingestWebhookPayload().
   */
  async fetchItems(
    _connection: IntegrationConnection,
    _decryptedToken: string
  ): Promise<RawExternalItem[]> {
    return [];
  }

  normalizeItem(raw: RawExternalItem): NormalizedIntakeItem {
    return {
      external_item_id: raw.externalId,
      title: raw.title,
      body: raw.body ?? null,
      author: raw.author ?? null,
      labels: raw.labels ?? [],
      source_ref: raw.sourceRef ?? null,
      external_created_at: raw.createdAt ?? null,
    };
  }

  /** Parse webhook payload items into RawExternalItem format. */
  parsePayload(payload: unknown): RawExternalItem[] {
    if (!payload || typeof payload !== "object") {
      throw new Error("Webhook payload must be a JSON object or array");
    }

    const items: WebhookPayloadItem[] = Array.isArray(payload) ? payload : [payload as WebhookPayloadItem];

    return items.map((item) => {
      if (!item.id || typeof item.id !== "string") {
        throw new Error("Each webhook item must have a string 'id' field");
      }
      return {
        externalId: item.id,
        title: item.title ?? item.summary ?? "(no title)",
        body: item.body ?? item.description,
        author: item.author,
        labels: item.labels ?? item.tags,
        createdAt: item.created_at,
        sourceRef: item.url ?? item.source,
      };
    });
  }
}

export const webhookAdapter = new WebhookAdapter();
adapterRegistry.register(webhookAdapter);
