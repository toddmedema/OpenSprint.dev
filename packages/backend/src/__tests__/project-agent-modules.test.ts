import { describe, expect, it } from "vitest";
import { buildAgentApiFailureMessages } from "../services/agent/agent-api-failure-messages.js";
import { parseImageForClaude } from "../services/agent/agent-image-attachments.js";
import { normalizeDeployment } from "../services/project/project-deployment-normalize.js";
import { getNextScheduledSelfImprovementRunAt } from "../services/project/project-scheduling.js";
import {
  clampValidationTimeoutMs,
  normalizeRepoPath,
  percentile,
} from "../services/project/project-settings-helpers.js";

describe("project-scheduling", () => {
  it("returns next calendar day UTC for daily", () => {
    const fixed = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    expect(getNextScheduledSelfImprovementRunAt("daily", fixed)).toBe(
      new Date(Date.UTC(2026, 0, 16)).toISOString()
    );
  });

  it("returns next Sunday UTC for weekly when today is Wednesday", () => {
    // 2026-01-14 is Wednesday UTC
    const wed = new Date(Date.UTC(2026, 0, 14, 10, 0, 0));
    expect(getNextScheduledSelfImprovementRunAt("weekly", wed)).toBe(
      new Date(Date.UTC(2026, 0, 18)).toISOString()
    );
  });
});

describe("project-deployment-normalize", () => {
  it("defaults to custom mode when mode missing", () => {
    const d = normalizeDeployment(undefined);
    expect(d.mode).toBe("custom");
  });

  it("preserves expo mode and channel default", () => {
    const d = normalizeDeployment({ mode: "expo" });
    expect(d.mode).toBe("expo");
    expect(d.expoConfig?.channel).toBe("preview");
  });
});

describe("project-settings-helpers", () => {
  it("normalizeRepoPath trims and strips trailing slashes", () => {
    expect(normalizeRepoPath("  /foo/bar///  ")).toBe("/foo/bar");
  });

  it("clampValidationTimeoutMs clamps to shared bounds", () => {
    expect(clampValidationTimeoutMs(Number.NaN)).toBe(300_000);
    expect(clampValidationTimeoutMs(1)).toBe(60_000);
  });

  it("percentile picks index from sorted samples", () => {
    expect(percentile([10, 20, 30], 0.5)).toBe(20);
  });
});

describe("agent-api-failure-messages", () => {
  it("returns distinct copy for exhausted keys", () => {
    const a = buildAgentApiFailureMessages("openai", "rate_limit");
    const b = buildAgentApiFailureMessages("openai", "rate_limit", { allKeysExhausted: true });
    expect(a.userMessage).not.toBe(b.userMessage);
  });
});

describe("agent-image-attachments", () => {
  it("parseImageForClaude accepts raw base64 as png", () => {
    const r = parseImageForClaude("abcd");
    expect(r.media_type).toBe("image/png");
    expect(r.data).toBe("abcd");
  });
});
