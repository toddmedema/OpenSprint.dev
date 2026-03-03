import { describe, it, expect } from "vitest";
import {
  getDefaultProviderFromEnvKeys,
  hasNoApiKeys,
} from "./agentConfigDefaults";

describe("getDefaultProviderFromEnvKeys", () => {
  it("returns claude when anthropic has keys", () => {
    expect(
      getDefaultProviderFromEnvKeys({
        anthropic: true,
        cursor: false,
        openai: false,
      })
    ).toBe("claude");
  });

  it("returns openai when only openai has keys", () => {
    expect(
      getDefaultProviderFromEnvKeys({
        anthropic: false,
        cursor: false,
        openai: true,
      })
    ).toBe("openai");
  });

  it("returns cursor when only cursor has keys", () => {
    expect(
      getDefaultProviderFromEnvKeys({
        anthropic: false,
        cursor: true,
        openai: false,
      })
    ).toBe("cursor");
  });

  it("returns claude first when multiple providers have keys", () => {
    expect(
      getDefaultProviderFromEnvKeys({
        anthropic: true,
        cursor: true,
        openai: true,
      })
    ).toBe("claude");
  });

  it("returns openai before cursor when both have keys", () => {
    expect(
      getDefaultProviderFromEnvKeys({
        anthropic: false,
        cursor: true,
        openai: true,
      })
    ).toBe("openai");
  });

  it("returns claude when no keys (first in order)", () => {
    expect(
      getDefaultProviderFromEnvKeys({
        anthropic: false,
        cursor: false,
        openai: false,
      })
    ).toBe("claude");
  });

  it("returns claude when envKeys is null", () => {
    expect(getDefaultProviderFromEnvKeys(null)).toBe("claude");
  });
});

describe("hasNoApiKeys", () => {
  it("returns true when all keys are false", () => {
    expect(
      hasNoApiKeys({
        anthropic: false,
        cursor: false,
        openai: false,
      })
    ).toBe(true);
  });

  it("returns false when anthropic has keys", () => {
    expect(
      hasNoApiKeys({
        anthropic: true,
        cursor: false,
        openai: false,
      })
    ).toBe(false);
  });

  it("returns false when cursor has keys", () => {
    expect(
      hasNoApiKeys({
        anthropic: false,
        cursor: true,
        openai: false,
      })
    ).toBe(false);
  });

  it("returns false when openai has keys", () => {
    expect(
      hasNoApiKeys({
        anthropic: false,
        cursor: false,
        openai: true,
      })
    ).toBe(false);
  });

  it("returns false when envKeys is null", () => {
    expect(hasNoApiKeys(null)).toBe(false);
  });
});
