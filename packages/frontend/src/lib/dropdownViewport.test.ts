import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDropdownPositionRightAligned,
  getDropdownPositionLeftAligned,
  TOAST_SAFE_STYLE,
} from "./dropdownViewport";

describe("dropdownViewport", () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    vi.stubGlobal("window", {
      innerWidth: 1024,
      innerHeight: 768,
    });
  });

  afterEach(() => {
    vi.stubGlobal("window", {
      innerWidth: originalInnerWidth,
      innerHeight: originalInnerHeight,
    });
  });

  describe("getDropdownPositionRightAligned", () => {
    it("positions dropdown below trigger on desktop", () => {
      const rect = new DOMRect(800, 100, 100, 40);
      const style = getDropdownPositionRightAligned(rect);
      expect(style.position).toBe("fixed");
      expect(style.top).toBe(144);
      expect(style.right).toBe(124);
      expect(style.maxHeight).toBe("90vh");
      expect(style.overflowY).toBe("auto");
    });

    it("uses bottom-up on mobile when space below is insufficient", () => {
      vi.stubGlobal("window", { innerWidth: 375, innerHeight: 667 });
      const rect = new DOMRect(300, 600, 80, 40);
      const style = getDropdownPositionRightAligned(rect, {
        minWidth: 220,
        estimatedHeight: 280,
      });
      expect(style.position).toBe("fixed");
      expect(style.bottom).toBeDefined();
      expect(style.bottom).toBe(667 - 600 + 4);
    });

    it("respects minWidth option", () => {
      const rect = new DOMRect(900, 100, 50, 40);
      const style = getDropdownPositionRightAligned(rect, { minWidth: 260 });
      expect(style.minWidth).toBe(260);
    });
  });

  describe("getDropdownPositionLeftAligned", () => {
    it("positions dropdown below trigger", () => {
      const rect = new DOMRect(200, 100, 40, 40);
      const style = getDropdownPositionLeftAligned(rect);
      expect(style.position).toBe("fixed");
      expect(style.top).toBe(144);
      expect(style.left).toBeGreaterThanOrEqual(8);
      expect(style.maxHeight).toBe("90vh");
    });

    it("clamps left to stay within viewport", () => {
      const rect = new DOMRect(50, 100, 40, 40);
      const style = getDropdownPositionLeftAligned(rect, { minWidth: 140 });
      expect(style.left).toBeGreaterThanOrEqual(8);
    });
  });

  describe("TOAST_SAFE_STYLE", () => {
    it("provides safe area insets for bottom and right", () => {
      expect(TOAST_SAFE_STYLE.bottom).toContain("safe-area-inset-bottom");
      expect(TOAST_SAFE_STYLE.right).toContain("safe-area-inset-right");
    });
  });
});
