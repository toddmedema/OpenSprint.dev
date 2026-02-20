import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isMac, getSubmitShortcutLabel } from "./platform";

describe("platform", () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    vi.stubGlobal("navigator", { ...originalNavigator });
  });

  afterEach(() => {
    vi.stubGlobal("navigator", originalNavigator);
  });

  describe("isMac", () => {
    it("returns true when navigator.platform includes Mac", () => {
      vi.stubGlobal("navigator", {
        ...originalNavigator,
        platform: "MacIntel",
        userAgent: "Mozilla/5.0",
      });
      expect(isMac()).toBe(true);
    });

    it("returns true when navigator.userAgent includes mac", () => {
      vi.stubGlobal("navigator", {
        ...originalNavigator,
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      });
      expect(isMac()).toBe(true);
    });

    it("returns true when navigator.userAgentData.platform is macOS", () => {
      vi.stubGlobal("navigator", {
        ...originalNavigator,
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0",
        userAgentData: { platform: "macOS" },
      });
      expect(isMac()).toBe(true);
    });

    it("returns false on Windows", () => {
      vi.stubGlobal("navigator", {
        ...originalNavigator,
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      });
      expect(isMac()).toBe(false);
    });

    it("returns false on Linux", () => {
      vi.stubGlobal("navigator", {
        ...originalNavigator,
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      });
      expect(isMac()).toBe(false);
    });
  });

  describe("getSubmitShortcutLabel", () => {
    it("returns Cmd + Enter to submit on macOS", () => {
      vi.stubGlobal("navigator", {
        ...originalNavigator,
        platform: "MacIntel",
        userAgent: "Mozilla/5.0",
      });
      expect(getSubmitShortcutLabel()).toBe("Cmd + Enter to submit");
    });

    it("returns Ctrl + Enter to submit on Windows", () => {
      vi.stubGlobal("navigator", {
        ...originalNavigator,
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      });
      expect(getSubmitShortcutLabel()).toBe("Ctrl + Enter to submit");
    });

    it("returns Ctrl + Enter to submit on Linux", () => {
      vi.stubGlobal("navigator", {
        ...originalNavigator,
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      });
      expect(getSubmitShortcutLabel()).toBe("Ctrl + Enter to submit");
    });
  });
});
