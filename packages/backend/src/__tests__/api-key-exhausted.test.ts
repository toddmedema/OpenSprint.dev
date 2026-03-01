import { describe, it, expect, beforeEach } from "vitest";
import {
  markExhausted,
  clearExhausted,
  isExhausted,
} from "../services/api-key-exhausted.service.js";

describe("api-key-exhausted", () => {
  beforeEach(() => {
    // Service uses in-memory state; no reset needed between tests if we use unique projectIds
  });

  it("isExhausted returns false initially", () => {
    expect(isExhausted("proj-1", "ANTHROPIC_API_KEY")).toBe(false);
    expect(isExhausted("proj-1", "CURSOR_API_KEY")).toBe(false);
  });

  it("markExhausted sets exhausted state", () => {
    markExhausted("proj-1", "CURSOR_API_KEY");
    expect(isExhausted("proj-1", "CURSOR_API_KEY")).toBe(true);
    expect(isExhausted("proj-1", "ANTHROPIC_API_KEY")).toBe(false);
  });

  it("clearExhausted removes exhausted state", () => {
    markExhausted("proj-1", "CURSOR_API_KEY");
    expect(isExhausted("proj-1", "CURSOR_API_KEY")).toBe(true);
    clearExhausted("proj-1", "CURSOR_API_KEY");
    expect(isExhausted("proj-1", "CURSOR_API_KEY")).toBe(false);
  });

  it("exhausted state is per-project and per-provider", () => {
    markExhausted("proj-1", "CURSOR_API_KEY");
    markExhausted("proj-1", "OPENAI_API_KEY");
    markExhausted("proj-2", "CURSOR_API_KEY");

    expect(isExhausted("proj-1", "CURSOR_API_KEY")).toBe(true);
    expect(isExhausted("proj-1", "OPENAI_API_KEY")).toBe(true);
    expect(isExhausted("proj-1", "ANTHROPIC_API_KEY")).toBe(false);
    expect(isExhausted("proj-2", "CURSOR_API_KEY")).toBe(true);
    expect(isExhausted("proj-2", "ANTHROPIC_API_KEY")).toBe(false);
  });
});
