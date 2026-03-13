import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { preloadPhaseData, preloadPhaseChunks, schedulePhasePreload } from "./phasePreload";
import { queryKeys } from "../api/queryKeys";

describe("phasePreload", () => {
  describe("preloadPhaseData", () => {
    it("prefetches phase-related queries for the project", async () => {
      const queryClient = new QueryClient();
      const prefetchSpy = vi.spyOn(queryClient, "prefetchQuery");

      preloadPhaseData("proj-1", queryClient);

      await vi.waitFor(() => {
        expect(prefetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: queryKeys.execute.status("proj-1"),
          })
        );
        expect(prefetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: queryKeys.deliver.status("proj-1"),
          })
        );
        expect(prefetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: queryKeys.deliver.history("proj-1"),
          })
        );
        expect(prefetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: queryKeys.prd.detail("proj-1"),
          })
        );
        expect(prefetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: queryKeys.plans.status("proj-1"),
          })
        );
        expect(prefetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: queryKeys.feedback.list("proj-1"),
          })
        );
      });

      prefetchSpy.mockRestore();
    });

    it("does not throw when prefetch fails", () => {
      const queryClient = new QueryClient();
      vi.spyOn(queryClient, "prefetchQuery").mockRejectedValue(new Error("network error"));

      expect(() => preloadPhaseData("proj-1", queryClient)).not.toThrow();
    });
  });

  describe("preloadPhaseChunks", () => {
    it("does not throw", () => {
      expect(() => preloadPhaseChunks()).not.toThrow();
    });
  });

  describe("schedulePhasePreload", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("schedules preload and runs it after delay or idle", () => {
      const queryClient = new QueryClient();
      const prefetchSpy = vi.spyOn(queryClient, "prefetchQuery");

      schedulePhasePreload("proj-1", queryClient);

      // requestIdleCallback may not be called in test env; if setTimeout is used (fallback), advance timers
      vi.advanceTimersByTime(150);

      expect(prefetchSpy).toHaveBeenCalled();
      prefetchSpy.mockRestore();
      vi.useRealTimers();
    });
  });
});
