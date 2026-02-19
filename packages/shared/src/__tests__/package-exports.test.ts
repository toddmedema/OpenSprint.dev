/**
 * Integration test: verifies that @opensprint/shared package exports resolve
 * correctly. Exports use fallback: dist (production) first, src (dev) when dist
 * is absent. Both Vite (frontend) and tsx (backend) resolve during development;
 * production build uses compiled dist/ for node dist/index.js.
 */
import { describe, it, expect } from "vitest";
import * as shared from "@opensprint/shared";

describe("package exports (src/index.ts resolution)", () => {
  it("exports constants", () => {
    expect(shared.API_PREFIX).toBeDefined();
    expect(shared.OPENSPRINT_PATHS).toBeDefined();
  });

  it("exports plan template utilities", () => {
    expect(shared.getPlanTemplate).toBeDefined();
    expect(typeof shared.getPlanTemplate).toBe("function");
  });

  it("exports bead ID utilities", () => {
    expect(shared.getEpicId).toBeDefined();
    expect(typeof shared.getEpicId).toBe("function");
  });

  it("exports deployment utilities", () => {
    expect(shared.getDefaultDeploymentTarget).toBeDefined();
    expect(typeof shared.getDefaultDeploymentTarget).toBe("function");
  });
});
