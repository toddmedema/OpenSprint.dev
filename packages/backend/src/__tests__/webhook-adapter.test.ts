import { describe, it, expect } from "vitest";
import { WebhookAdapter } from "../services/adapters/webhook-adapter.js";

describe("WebhookAdapter", () => {
  const adapter = new WebhookAdapter();

  describe("capabilities", () => {
    it("has correct provider", () => {
      expect(adapter.provider).toBe("webhook");
    });

    it("supports webhook but not OAuth", () => {
      expect(adapter.capabilities.supportsOAuth).toBe(false);
      expect(adapter.capabilities.supportsWebhook).toBe(true);
      expect(adapter.capabilities.supportsPoll).toBe(false);
    });
  });

  describe("parsePayload", () => {
    it("parses a single item object", () => {
      const payload = { id: "w-1", title: "Bug report", body: "Details here" };
      const items = adapter.parsePayload(payload);
      expect(items).toHaveLength(1);
      expect(items[0].externalId).toBe("w-1");
      expect(items[0].title).toBe("Bug report");
      expect(items[0].body).toBe("Details here");
    });

    it("parses an array of items", () => {
      const payload = [
        { id: "w-1", title: "First" },
        { id: "w-2", title: "Second", labels: ["bug"] },
      ];
      const items = adapter.parsePayload(payload);
      expect(items).toHaveLength(2);
      expect(items[1].labels).toEqual(["bug"]);
    });

    it("uses summary as title fallback", () => {
      const payload = { id: "w-3", summary: "My summary" };
      const items = adapter.parsePayload(payload);
      expect(items[0].title).toBe("My summary");
    });

    it("throws for missing id", () => {
      expect(() => adapter.parsePayload({ title: "No ID" })).toThrow("string 'id' field");
    });

    it("throws for non-object payload", () => {
      expect(() => adapter.parsePayload(null)).toThrow("JSON object or array");
      expect(() => adapter.parsePayload("string")).toThrow("JSON object or array");
    });

    it("uses tags as labels fallback", () => {
      const payload = { id: "w-4", title: "With tags", tags: ["feature", "ui"] };
      const items = adapter.parsePayload(payload);
      expect(items[0].labels).toEqual(["feature", "ui"]);
    });
  });

  describe("normalizeItem", () => {
    it("normalizes a raw item", () => {
      const normalized = adapter.normalizeItem({
        externalId: "w-1",
        title: "Test",
        body: "Body",
        author: "user",
        labels: ["bug"],
        createdAt: "2024-01-01",
        sourceRef: "https://example.com",
      });
      expect(normalized.external_item_id).toBe("w-1");
      expect(normalized.title).toBe("Test");
      expect(normalized.labels).toEqual(["bug"]);
    });
  });

  describe("fetchItems", () => {
    it("returns empty array (webhook is push-based)", async () => {
      const items = await adapter.fetchItems(
        { id: "conn-1", project_id: "p-1", provider: "webhook" } as never,
        "token"
      );
      expect(items).toEqual([]);
    });
  });
});
