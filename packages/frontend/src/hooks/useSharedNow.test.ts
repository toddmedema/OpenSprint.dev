import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSharedNow } from "./useSharedNow";

describe("useSharedNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps a shared interval alive across unrelated rerenders", () => {
    vi.setSystemTime(new Date("2026-02-16T12:00:00.000Z"));
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    const { result, rerender, unmount } = renderHook(
      ({ label }) => {
        const now = useSharedNow(1_000);
        return `${label}:${now?.toISOString()}`;
      },
      { initialProps: { label: "first" } }
    );

    expect(result.current).toContain("2026-02-16T12:00:00.000Z");
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    rerender({ label: "second" });

    expect(result.current).toContain("2026-02-16T12:00:00.000Z");
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
