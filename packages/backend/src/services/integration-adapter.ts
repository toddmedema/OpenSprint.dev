/**
 * Provider-agnostic integration adapter interface and registry.
 *
 * Each provider (Todoist, GitHub, Slack, Webhook) implements this contract.
 * The registry resolves adapters by provider ID for use by the ingestion pipeline.
 */

import type {
  IntegrationProvider,
  IntegrationConnection,
  IntegrationSourceOption,
} from "@opensprint/shared";
import { createLogger } from "../utils/logger.js";

const log = createLogger("integration-adapter");

/** Raw external item before normalization. */
export interface RawExternalItem {
  externalId: string;
  title: string;
  body?: string;
  author?: string;
  labels?: string[];
  priority?: number;
  createdAt?: string;
  sourceRef?: string;
  rawPayload?: unknown;
}

/** Normalized item ready for intake persistence. */
export interface NormalizedIntakeItem {
  external_item_id: string;
  title: string;
  body: string | null;
  author: string | null;
  labels: string[];
  source_ref: string | null;
  external_created_at: string | null;
}

/** OAuth result returned by adapters that use OAuth. */
export interface OAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  userId?: string;
  userEmail?: string;
  scopes?: string;
}

/** Capabilities a provider supports. */
export interface AdapterCapabilities {
  supportsOAuth: boolean;
  supportsPoll: boolean;
  supportsWebhook: boolean;
  supportsSourceSelection: boolean;
  supportsDelete: boolean;
}

/**
 * Provider adapter contract.
 * Not all methods are required — capabilities declare what is available.
 */
export interface IntegrationAdapter {
  readonly provider: IntegrationProvider;
  readonly capabilities: AdapterCapabilities;

  /** Build an OAuth authorization URL. Only called when supportsOAuth is true. */
  buildAuthorizationUrl?(state: string): string;

  /** Exchange an OAuth code for tokens. */
  exchangeToken?(code: string, state: string): Promise<OAuthResult>;

  /** Revoke an access token on disconnect. */
  revokeToken?(accessToken: string): Promise<void>;

  /** List available sources (repos, projects, channels) for the user to choose from. */
  listSources?(connection: IntegrationConnection, decryptedToken: string): Promise<IntegrationSourceOption[]>;

  /**
   * Fetch new items from the provider. Returns raw items that will be
   * normalized by normalizeItem().
   */
  fetchItems(connection: IntegrationConnection, decryptedToken: string): Promise<RawExternalItem[]>;

  /** Normalize a raw external item to the common intake schema. */
  normalizeItem(raw: RawExternalItem): NormalizedIntakeItem;

  /**
   * Acknowledge/delete an item from the source after successful import.
   * Only called when supportsDelete is true.
   */
  acknowledgeItem?(externalItemId: string, decryptedToken: string): Promise<void>;
}

/**
 * Registry of all available integration adapters.
 * Adapters register themselves on module load.
 */
class IntegrationAdapterRegistry {
  private adapters = new Map<IntegrationProvider, IntegrationAdapter>();

  register(adapter: IntegrationAdapter): void {
    if (this.adapters.has(adapter.provider)) {
      log.warn("Overwriting existing adapter registration", { provider: adapter.provider });
    }
    this.adapters.set(adapter.provider, adapter);
    log.info("Registered integration adapter", { provider: adapter.provider });
  }

  get(provider: IntegrationProvider): IntegrationAdapter | undefined {
    return this.adapters.get(provider);
  }

  getOrThrow(provider: IntegrationProvider): IntegrationAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`No adapter registered for provider: ${provider}`);
    }
    return adapter;
  }

  has(provider: IntegrationProvider): boolean {
    return this.adapters.has(provider);
  }

  listProviders(): IntegrationProvider[] {
    return Array.from(this.adapters.keys());
  }

  listAll(): IntegrationAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export const adapterRegistry = new IntegrationAdapterRegistry();
