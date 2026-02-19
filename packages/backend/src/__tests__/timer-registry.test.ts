import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { TimerRegistry } from "../services/timer-registry.js";

describe("TimerRegistry", () => {
  let registry: TimerRegistry;

  beforeEach(() => {
    registry = new TimerRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    registry.clearAll();
    vi.useRealTimers();
  });

  describe("setTimeout", () => {
    it("executes callback after delay", () => {
      const fn = vi.fn();
      registry.setTimeout("t1", fn, 1000);

      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(999);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("removes timer from registry after execution", () => {
      const fn = vi.fn();
      registry.setTimeout("t1", fn, 1000);
      expect(registry.has("t1")).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(registry.has("t1")).toBe(false);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("replaces existing timer with same name", () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      registry.setTimeout("t1", fn1, 1000);
      registry.setTimeout("t1", fn2, 500);

      vi.advanceTimersByTime(500);
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledTimes(1);
    });
  });

  describe("setInterval", () => {
    it("executes callback repeatedly at interval", () => {
      const fn = vi.fn();
      registry.setInterval("i1", fn, 100);

      vi.advanceTimersByTime(99);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("replaces existing interval with same name", () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      registry.setInterval("i1", fn1, 100);
      registry.setInterval("i1", fn2, 100);

      vi.advanceTimersByTime(100);
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledTimes(1);
    });
  });

  describe("clear", () => {
    it("cancels timeout before execution", () => {
      const fn = vi.fn();
      registry.setTimeout("t1", fn, 1000);
      registry.clear("t1");

      vi.advanceTimersByTime(2000);
      expect(fn).not.toHaveBeenCalled();
      expect(registry.has("t1")).toBe(false);
    });

    it("cancels interval", () => {
      const fn = vi.fn();
      registry.setInterval("i1", fn, 100);
      registry.clear("i1");

      vi.advanceTimersByTime(500);
      expect(fn).not.toHaveBeenCalled();
      expect(registry.has("i1")).toBe(false);
    });

    it("is no-op when name does not exist", () => {
      expect(() => registry.clear("nonexistent")).not.toThrow();
    });
  });

  describe("has", () => {
    it("returns true when timer exists", () => {
      registry.setTimeout("t1", () => {}, 1000);
      expect(registry.has("t1")).toBe(true);
    });

    it("returns false when timer does not exist", () => {
      expect(registry.has("t1")).toBe(false);
    });

    it("returns false after clear", () => {
      registry.setTimeout("t1", () => {}, 1000);
      registry.clear("t1");
      expect(registry.has("t1")).toBe(false);
    });
  });

  describe("clearAll", () => {
    it("clears all active timers", () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      registry.setTimeout("t1", fn1, 1000);
      registry.setInterval("i1", fn2, 100);

      registry.clearAll();

      vi.advanceTimersByTime(2000);
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();
      expect(registry.has("t1")).toBe(false);
      expect(registry.has("i1")).toBe(false);
    });

    it("is safe to call when registry is empty", () => {
      expect(() => registry.clearAll()).not.toThrow();
    });
  });
});
