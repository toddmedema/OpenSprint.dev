import { describe, expect, it } from "vitest";
import { looksLikeNodeEngineQualityGateFailure } from "../services/merge-quality-gate-runner.js";

describe("looksLikeNodeEngineQualityGateFailure", () => {
  it("detects validate-engines and EBADENGINE output", () => {
    expect(
      looksLikeNodeEngineQualityGateFailure(
        "file:///usr/local/lib/node_modules/npm/lib/cli/validate-engines.js:29"
      )
    ).toBe(true);
    expect(looksLikeNodeEngineQualityGateFailure("npm ERR! code EBADENGINE")).toBe(true);
    expect(looksLikeNodeEngineQualityGateFailure('The engine "node" is incompatible')).toBe(true);
  });

  it("returns false for ordinary ESLint errors", () => {
    expect(
      looksLikeNodeEngineQualityGateFailure("855:7  error  'x' is never used  no-unused-vars")
    ).toBe(false);
  });
});
