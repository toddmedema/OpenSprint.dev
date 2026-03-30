import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { PrdProposalStore } from "../services/prd-proposal-store.js";

describe("PrdProposalStore", () => {
  let store: PrdProposalStore;

  afterEach(() => {
    store?.dispose();
  });

  describe("register", () => {
    beforeEach(() => {
      store = new PrdProposalStore({ ttlMs: 60_000, sweepIntervalMs: 600_000 });
    });

    it("stores a proposal and returns it with createdAt", () => {
      const result = store.register("hil-0001", "# Proposed SPEC\n\nContent here");

      expect(result).toEqual({
        proposedContent: "# Proposed SPEC\n\nContent here",
        createdAt: expect.any(String),
        baseContentHash: undefined,
      });
      expect(new Date(result.createdAt).getTime()).not.toBeNaN();
    });

    it("computes baseContentHash when baseContent is provided", () => {
      const baseContent = "# Current SPEC\n\nOriginal content";
      const expectedHash = crypto.createHash("sha256").update(baseContent, "utf8").digest("hex");

      const result = store.register("hil-0002", "# Proposed", baseContent);

      expect(result.baseContentHash).toBe(expectedHash);
    });

    it("does not set baseContentHash when baseContent is omitted", () => {
      const result = store.register("hil-0003", "# Proposed");
      expect(result.baseContentHash).toBeUndefined();
    });

    it("overwrites an existing entry for the same requestId", () => {
      store.register("hil-dup", "first content");
      store.register("hil-dup", "second content");

      const retrieved = store.get("hil-dup");
      expect(retrieved?.proposedContent).toBe("second content");
      expect(store.size).toBe(1);
    });

    it("increments size for distinct requestIds", () => {
      store.register("hil-a", "content a");
      store.register("hil-b", "content b");
      store.register("hil-c", "content c");

      expect(store.size).toBe(3);
    });
  });

  describe("get", () => {
    beforeEach(() => {
      store = new PrdProposalStore({ ttlMs: 60_000, sweepIntervalMs: 600_000 });
    });

    it("returns proposal for a valid requestId", () => {
      store.register("hil-get1", "proposed content", "base content");

      const result = store.get("hil-get1");

      expect(result).not.toBeNull();
      expect(result!.proposedContent).toBe("proposed content");
      expect(result!.createdAt).toBeDefined();
      expect(result!.baseContentHash).toBeDefined();
    });

    it("returns null for an unknown requestId", () => {
      expect(store.get("hil-nonexistent")).toBeNull();
    });

    it("returns null for an expired entry (lazy expiry)", () => {
      store = new PrdProposalStore({ ttlMs: 50, sweepIntervalMs: 600_000 });
      store.register("hil-exp", "content");

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = store.get("hil-exp");
          expect(result).toBeNull();
          expect(store.size).toBe(0);
          resolve();
        }, 100);
      });
    });

    it("returns the proposal when TTL has not elapsed", () => {
      store = new PrdProposalStore({ ttlMs: 5_000, sweepIntervalMs: 600_000 });
      store.register("hil-fresh", "still fresh");

      const result = store.get("hil-fresh");
      expect(result).not.toBeNull();
      expect(result!.proposedContent).toBe("still fresh");
    });

    it("does not return internal fields (expiresAt)", () => {
      store.register("hil-internal", "content");
      const result = store.get("hil-internal");

      expect(result).not.toBeNull();
      expect(Object.keys(result!)).toEqual(
        expect.arrayContaining(["proposedContent", "createdAt"])
      );
      expect("expiresAt" in result!).toBe(false);
    });
  });

  describe("remove", () => {
    beforeEach(() => {
      store = new PrdProposalStore({ ttlMs: 60_000, sweepIntervalMs: 600_000 });
    });

    it("removes an existing entry and returns true", () => {
      store.register("hil-rm1", "content");

      expect(store.remove("hil-rm1")).toBe(true);
      expect(store.get("hil-rm1")).toBeNull();
      expect(store.size).toBe(0);
    });

    it("returns false for an unknown requestId", () => {
      expect(store.remove("hil-nope")).toBe(false);
    });

    it("does not affect other entries", () => {
      store.register("hil-keep", "keep me");
      store.register("hil-drop", "drop me");

      store.remove("hil-drop");

      expect(store.get("hil-keep")).not.toBeNull();
      expect(store.get("hil-drop")).toBeNull();
      expect(store.size).toBe(1);
    });
  });

  describe("sweep", () => {
    it("removes expired entries and returns the count", async () => {
      store = new PrdProposalStore({ ttlMs: 50, sweepIntervalMs: 600_000 });
      store.register("hil-s1", "a");
      store.register("hil-s2", "b");

      await new Promise((r) => setTimeout(r, 100));

      const removed = store.sweep();
      expect(removed).toBe(2);
      expect(store.size).toBe(0);
    });

    it("keeps non-expired entries during sweep", async () => {
      store = new PrdProposalStore({ ttlMs: 50, sweepIntervalMs: 600_000 });
      store.register("hil-old", "will expire");

      await new Promise((r) => setTimeout(r, 100));

      store.register("hil-new", "still fresh");

      const removed = store.sweep();
      expect(removed).toBe(1);
      expect(store.size).toBe(1);
      expect(store.get("hil-new")?.proposedContent).toBe("still fresh");
    });

    it("returns 0 when nothing is expired", () => {
      store = new PrdProposalStore({ ttlMs: 60_000, sweepIntervalMs: 600_000 });
      store.register("hil-alive", "content");

      const removed = store.sweep();
      expect(removed).toBe(0);
      expect(store.size).toBe(1);
    });

    it("automatic sweep timer fires and cleans expired entries", async () => {
      store = new PrdProposalStore({ ttlMs: 30, sweepIntervalMs: 80 });
      store.register("hil-auto", "auto-expire");

      await new Promise((r) => setTimeout(r, 200));

      expect(store.size).toBe(0);
    });
  });

  describe("dispose", () => {
    it("stops the sweep timer", () => {
      store = new PrdProposalStore({ ttlMs: 60_000, sweepIntervalMs: 100 });
      const spy = vi.spyOn(store, "sweep");

      store.dispose();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(spy.mock.calls.length).toBe(0);
          resolve();
        }, 250);
      });
    });
  });

  describe("concurrent non-PRD requests unchanged", () => {
    beforeEach(() => {
      store = new PrdProposalStore({ ttlMs: 60_000, sweepIntervalMs: 600_000 });
    });

    it("only stores entries explicitly registered (no side effects on unrelated keys)", () => {
      store.register("hil-prd-001", "spec content");

      expect(store.get("hil-other-002")).toBeNull();
      expect(store.get("hil-prd-001")).not.toBeNull();
    });
  });
});
