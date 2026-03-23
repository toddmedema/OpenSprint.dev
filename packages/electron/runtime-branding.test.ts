import { describe, expect, it } from "vitest";
import { shouldApplyRuntimeDockIcon } from "./runtime-branding";

describe("shouldApplyRuntimeDockIcon", () => {
  it("keeps the packaged macOS app icon under bundle control", () => {
    expect(shouldApplyRuntimeDockIcon("darwin", true)).toBe(false);
  });

  it("still sets a dock icon for unpackaged macOS development runs", () => {
    expect(shouldApplyRuntimeDockIcon("darwin", false)).toBe(true);
  });

  it("never applies a dock icon outside macOS", () => {
    expect(shouldApplyRuntimeDockIcon("win32", false)).toBe(false);
    expect(shouldApplyRuntimeDockIcon("linux", false)).toBe(false);
  });
});
