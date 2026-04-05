import { describe, expect, it } from "vitest";

/**
 * Smoke: ensure ESM `.js` specifiers resolve to on-disk TS sources under Vitest.
 * Regression guard for drizzle-schema-pg path failures (merge gates / coverage).
 */
describe("plan-store.service module graph", () => {
  it("loads PlanStore without mocking drizzle-schema-pg", async () => {
    const mod = await import("../services/plan-store.service.js");
    expect(mod.PlanStore).toBeTypeOf("function");
  });
});
