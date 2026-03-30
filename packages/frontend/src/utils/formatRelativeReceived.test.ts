import { describe, it, expect } from "vitest";
import { formatRelativeReceived } from "./formatRelativeReceived";

describe("formatRelativeReceived", () => {
  const now = new Date("2025-06-01T12:00:00.000Z").getTime();

  it("returns empty string for invalid iso", () => {
    expect(formatRelativeReceived("not-a-date", now)).toBe("");
  });

  it("formats seconds and minutes", () => {
    expect(formatRelativeReceived("2025-06-01T11:59:40.000Z", now)).toBe("20s ago");
    expect(formatRelativeReceived("2025-06-01T11:59:00.000Z", now)).toBe("1m ago");
    expect(formatRelativeReceived("2025-06-01T11:58:00.000Z", now)).toBe("2m ago");
  });
});
