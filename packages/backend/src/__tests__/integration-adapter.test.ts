import { describe, it, expect } from "vitest";
import {
  adapterRegistry,
  type IntegrationAdapter,
  type RawExternalItem,
  type NormalizedIntakeItem,
} from "../services/integration-adapter.js";

function createMockAdapter(provider: string): IntegrationAdapter {
  return {
    provider: provider as import("@opensprint/shared").IntegrationProvider,
    capabilities: {
      supportsOAuth: false,
      supportsPoll: true,
      supportsWebhook: false,
      supportsSourceSelection: false,
      supportsDelete: false,
    },
    async fetchItems() { return []; },
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
    },
  };
}

describe("IntegrationAdapterRegistry", () => {
  it("registers and retrieves an adapter by provider", () => {
    const adapter = createMockAdapter("todoist");
    adapterRegistry.register(adapter);
    expect(adapterRegistry.has("todoist")).toBe(true);
    expect(adapterRegistry.get("todoist")).toBe(adapter);
  });

  it("getOrThrow throws for unregistered provider", () => {
    expect(() => adapterRegistry.getOrThrow("nonexistent" as never)).toThrow(
      "No adapter registered for provider: nonexistent"
    );
  });

  it("lists all registered providers", () => {
    const providers = adapterRegistry.listProviders();
    expect(providers).toContain("todoist");
  });

  it("lists all registered adapters", () => {
    const adapters = adapterRegistry.listAll();
    expect(adapters.length).toBeGreaterThan(0);
    expect(adapters[0]).toHaveProperty("provider");
    expect(adapters[0]).toHaveProperty("capabilities");
  });
});

describe("Adapter normalizeItem", () => {
  it("normalizes a raw item correctly", () => {
    const adapter = createMockAdapter("todoist");
    const raw: RawExternalItem = {
      externalId: "ext-1",
      title: "Test Item",
      body: "body text",
      author: "user@example.com",
      labels: ["bug", "urgent"],
      createdAt: "2024-01-01T00:00:00Z",
      sourceRef: "https://example.com/1",
    };

    const normalized = adapter.normalizeItem(raw);
    expect(normalized.external_item_id).toBe("ext-1");
    expect(normalized.title).toBe("Test Item");
    expect(normalized.body).toBe("body text");
    expect(normalized.author).toBe("user@example.com");
    expect(normalized.labels).toEqual(["bug", "urgent"]);
    expect(normalized.source_ref).toBe("https://example.com/1");
  });

  it("handles missing optional fields", () => {
    const adapter = createMockAdapter("todoist");
    const raw: RawExternalItem = {
      externalId: "ext-2",
      title: "Minimal",
    };

    const normalized = adapter.normalizeItem(raw);
    expect(normalized.body).toBeNull();
    expect(normalized.author).toBeNull();
    expect(normalized.labels).toEqual([]);
    expect(normalized.source_ref).toBeNull();
  });
});
