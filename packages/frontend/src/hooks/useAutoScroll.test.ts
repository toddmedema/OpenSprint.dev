import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoScroll } from "./useAutoScroll";

function makeMockEl(
  overrides?: Partial<{ scrollTop: number; scrollHeight: number; clientHeight: number }>
) {
  return {
    scrollTop: 0,
    scrollHeight: 500,
    clientHeight: 200,
    ...overrides,
  };
}

type MockEl = ReturnType<typeof makeMockEl>;

function setRef(result: { current: ReturnType<typeof useAutoScroll> }, el: MockEl) {
  (result.current.containerRef as React.MutableRefObject<MockEl | null>).current = el;
}

describe("useAutoScroll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns containerRef, showJumpToBottom false initially, and jumpToBottom", () => {
    const { result } = renderHook(() => useAutoScroll({ contentLength: 0, resetKey: "task-1" }));

    expect(result.current.containerRef).toBeDefined();
    expect(result.current.showJumpToBottom).toBe(false);
    expect(typeof result.current.jumpToBottom).toBe("function");
    expect(typeof result.current.handleScroll).toBe("function");
  });

  it("scrolls to bottom when contentLength increases and auto-scroll is enabled", () => {
    const mockEl = makeMockEl();
    const { result, rerender } = renderHook(
      ({ contentLength }) => useAutoScroll({ contentLength, resetKey: "task-1" }),
      { initialProps: { contentLength: 0 } }
    );

    setRef(result, mockEl);

    rerender({ contentLength: 1 });

    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(mockEl.scrollTop).toBe(300); // scrollHeight - clientHeight
  });

  it("scrolls to bottom on initial open when content arrives", () => {
    const mockEl = makeMockEl();
    const { result, rerender } = renderHook(
      ({ contentLength }) => useAutoScroll({ contentLength, resetKey: "task-1" }),
      { initialProps: { contentLength: 0 } }
    );

    setRef(result, mockEl);

    rerender({ contentLength: 500 });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(mockEl.scrollTop).toBe(300);
  });

  it("sets showJumpToBottom when user scrolls up (away from bottom)", () => {
    const { result } = renderHook(() => useAutoScroll({ contentLength: 0, resetKey: "task-1" }));

    const mockEl = makeMockEl();
    setRef(result, mockEl);

    // scrollTop 0 means we're at top - far from bottom (distanceFromBottom = 300)
    act(() => {
      result.current.handleScroll();
    });

    expect(result.current.showJumpToBottom).toBe(true);
  });

  it("does not auto-scroll when user has scrolled up", () => {
    const mockEl = makeMockEl();
    const { result, rerender } = renderHook(
      ({ contentLength }) => useAutoScroll({ contentLength, resetKey: "task-1" }),
      { initialProps: { contentLength: 0 } }
    );

    setRef(result, mockEl);

    rerender({ contentLength: 10 });
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(mockEl.scrollTop).toBe(300);

    // User scrolls up
    mockEl.scrollTop = 0;
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.autoScrollEnabled).toBe(false);

    // New content arrives but should NOT auto-scroll
    rerender({ contentLength: 50 });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(mockEl.scrollTop).toBe(0);
  });

  it("clears showJumpToBottom when user scrolls to bottom (within threshold)", () => {
    const { result } = renderHook(() => useAutoScroll({ contentLength: 0, resetKey: "task-1" }));

    const mockEl = makeMockEl();
    setRef(result, mockEl);

    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.showJumpToBottom).toBe(true);

    // Scroll to bottom - scrollTop = scrollHeight - clientHeight = 300, distanceFromBottom = 0
    mockEl.scrollTop = 300;
    act(() => {
      result.current.handleScroll();
    });

    expect(result.current.showJumpToBottom).toBe(false);
  });

  it("re-enables auto-scroll when user scrolls back to bottom", () => {
    const mockEl = makeMockEl();
    const { result, rerender } = renderHook(
      ({ contentLength }) => useAutoScroll({ contentLength, resetKey: "task-1" }),
      { initialProps: { contentLength: 0 } }
    );

    setRef(result, mockEl);

    rerender({ contentLength: 10 });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    // User scrolls up
    mockEl.scrollTop = 0;
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.autoScrollEnabled).toBe(false);

    // User scrolls back to bottom (within threshold)
    mockEl.scrollTop = 280;
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.autoScrollEnabled).toBe(true);

    // New content should auto-scroll
    mockEl.scrollTop = 0;
    rerender({ contentLength: 80 });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(mockEl.scrollTop).toBe(300);
  });

  it("jumpToBottom scrolls to bottom and clears showJumpToBottom", () => {
    const { result } = renderHook(() => useAutoScroll({ contentLength: 0, resetKey: "task-1" }));

    const mockEl = makeMockEl();
    setRef(result, mockEl);

    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.showJumpToBottom).toBe(true);

    act(() => {
      result.current.jumpToBottom();
    });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(mockEl.scrollTop).toBe(300);
    expect(result.current.showJumpToBottom).toBe(false);
  });

  it("resets auto-scroll state when resetKey changes", () => {
    const { result, rerender } = renderHook(
      ({ resetKey }) => useAutoScroll({ contentLength: 0, resetKey }),
      { initialProps: { resetKey: "task-1" } }
    );

    const mockEl = makeMockEl();
    setRef(result, mockEl);

    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.showJumpToBottom).toBe(true);

    rerender({ resetKey: "task-2" });

    expect(result.current.showJumpToBottom).toBe(false);
  });

  it("scrolls to bottom when reopened with existing content via task switch", () => {
    const mockEl = makeMockEl();
    const { result, rerender } = renderHook(
      ({ contentLength, resetKey }: { contentLength: number; resetKey: string }) =>
        useAutoScroll({ contentLength, resetKey }),
      { initialProps: { contentLength: 0, resetKey: "task-1" } }
    );

    setRef(result, mockEl);

    // Task 1 gets content
    rerender({ contentLength: 200, resetKey: "task-1" });
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(mockEl.scrollTop).toBe(300);

    // Switch to task 2 with different (shorter) content
    mockEl.scrollTop = 0;
    rerender({ contentLength: 50, resetKey: "task-2" });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(mockEl.scrollTop).toBe(300);
    expect(result.current.autoScrollEnabled).toBe(true);
  });

  it("handles switching from long output to shorter output on task switch", () => {
    const mockEl = makeMockEl();
    const { result, rerender } = renderHook(
      ({ contentLength, resetKey }: { contentLength: number; resetKey: string }) =>
        useAutoScroll({ contentLength, resetKey }),
      { initialProps: { contentLength: 0, resetKey: "task-1" } }
    );

    setRef(result, mockEl);

    rerender({ contentLength: 5000, resetKey: "task-1" });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    // Switch to task with much shorter content
    mockEl.scrollTop = 0;
    rerender({ contentLength: 100, resetKey: "task-2" });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(mockEl.scrollTop).toBe(300);
  });

  it("continues auto-scrolling new content after reopen", () => {
    const mockEl = makeMockEl();
    const { result, rerender } = renderHook(
      ({ contentLength, resetKey }: { contentLength: number; resetKey: string }) =>
        useAutoScroll({ contentLength, resetKey }),
      { initialProps: { contentLength: 0, resetKey: "task-1" } }
    );

    setRef(result, mockEl);

    // Switch to task-2 with some content
    rerender({ contentLength: 50, resetKey: "task-2" });
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(mockEl.scrollTop).toBe(300);

    // New content streams in on task-2
    mockEl.scrollTop = 0;
    rerender({ contentLength: 100, resetKey: "task-2" });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(mockEl.scrollTop).toBe(300);
  });

  it("re-enables auto-scroll on task switch even if user had scrolled up", () => {
    const mockEl = makeMockEl();
    const { result, rerender } = renderHook(
      ({ contentLength, resetKey }: { contentLength: number; resetKey: string }) =>
        useAutoScroll({ contentLength, resetKey }),
      { initialProps: { contentLength: 0, resetKey: "task-1" } }
    );

    setRef(result, mockEl);

    rerender({ contentLength: 100, resetKey: "task-1" });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    // User scrolls up, disabling auto-scroll
    mockEl.scrollTop = 0;
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.autoScrollEnabled).toBe(false);
    expect(result.current.showJumpToBottom).toBe(true);

    // Switch to task-2: should reset and scroll to bottom
    rerender({ contentLength: 75, resetKey: "task-2" });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(result.current.autoScrollEnabled).toBe(true);
    expect(result.current.showJumpToBottom).toBe(false);
    expect(mockEl.scrollTop).toBe(300);
  });

  it("scrolls to bottom immediately on resetKey change even with same contentLength", () => {
    const mockEl = makeMockEl();
    const { result, rerender } = renderHook(
      ({ contentLength, resetKey }: { contentLength: number; resetKey: string }) =>
        useAutoScroll({ contentLength, resetKey }),
      { initialProps: { contentLength: 0, resetKey: "task-1" } }
    );

    setRef(result, mockEl);

    // Content arrives on task-1
    rerender({ contentLength: 50, resetKey: "task-1" });
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(mockEl.scrollTop).toBe(300);

    // User scrolls up
    mockEl.scrollTop = 0;
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.autoScrollEnabled).toBe(false);

    // Switch to task-2 with SAME contentLength — the resetKey effect
    // should still trigger an immediate scroll-to-bottom via rAF.
    rerender({ contentLength: 50, resetKey: "task-2" });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(mockEl.scrollTop).toBe(300);
    expect(result.current.autoScrollEnabled).toBe(true);
    expect(result.current.showJumpToBottom).toBe(false);
  });

  describe("triggerKey", () => {
    it("scrolls to bottom when triggerKey changes and auto-scroll is enabled", () => {
      const mockEl = makeMockEl();
      const { result, rerender } = renderHook(
        ({ contentLength, triggerKey }: { contentLength: number; triggerKey: number }) =>
          useAutoScroll({ contentLength, resetKey: "task-1", triggerKey }),
        { initialProps: { contentLength: 0, triggerKey: 0 } }
      );

      setRef(result, mockEl);

      // Get content so prevContentLength is set
      rerender({ contentLength: 100, triggerKey: 0 });
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(mockEl.scrollTop).toBe(300);

      // Simulate being at top after DOM changes
      mockEl.scrollTop = 0;

      // Change triggerKey — should scroll to bottom since auto-scroll is enabled
      rerender({ contentLength: 100, triggerKey: 1 });
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(mockEl.scrollTop).toBe(300);
    });

    it("does not scroll when triggerKey changes but auto-scroll is disabled", () => {
      const mockEl = makeMockEl();
      const { result, rerender } = renderHook(
        ({ contentLength, triggerKey }: { contentLength: number; triggerKey: number }) =>
          useAutoScroll({ contentLength, resetKey: "task-1", triggerKey }),
        { initialProps: { contentLength: 0, triggerKey: 0 } }
      );

      setRef(result, mockEl);

      rerender({ contentLength: 100, triggerKey: 0 });
      act(() => {
        vi.advanceTimersToNextFrame();
      });

      // User scrolls up — disables auto-scroll
      mockEl.scrollTop = 0;
      act(() => {
        result.current.handleScroll();
      });
      expect(result.current.autoScrollEnabled).toBe(false);

      // Change triggerKey — should NOT scroll because user opted out
      rerender({ contentLength: 100, triggerKey: 1 });
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(mockEl.scrollTop).toBe(0);
    });

    it("does not scroll when triggerKey is unchanged", () => {
      const mockEl = makeMockEl();
      const { result, rerender } = renderHook(
        ({ contentLength, triggerKey }: { contentLength: number; triggerKey: number }) =>
          useAutoScroll({ contentLength, resetKey: "task-1", triggerKey }),
        { initialProps: { contentLength: 0, triggerKey: 0 } }
      );

      setRef(result, mockEl);

      rerender({ contentLength: 100, triggerKey: 0 });
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(mockEl.scrollTop).toBe(300);

      mockEl.scrollTop = 0;

      // Same triggerKey, same contentLength — should not scroll
      rerender({ contentLength: 100, triggerKey: 0 });
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(mockEl.scrollTop).toBe(0);
    });

    it("does not reset user scroll-up state (unlike resetKey)", () => {
      const mockEl = makeMockEl();
      const { result, rerender } = renderHook(
        ({ contentLength, triggerKey }: { contentLength: number; triggerKey: number }) =>
          useAutoScroll({ contentLength, resetKey: "task-1", triggerKey }),
        { initialProps: { contentLength: 0, triggerKey: 0 } }
      );

      setRef(result, mockEl);

      rerender({ contentLength: 100, triggerKey: 0 });
      act(() => {
        vi.advanceTimersToNextFrame();
      });

      // User scrolls up
      mockEl.scrollTop = 0;
      act(() => {
        result.current.handleScroll();
      });
      expect(result.current.autoScrollEnabled).toBe(false);
      expect(result.current.showJumpToBottom).toBe(true);

      // triggerKey changes but should NOT reset the user's scroll intent
      rerender({ contentLength: 100, triggerKey: 1 });
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(result.current.autoScrollEnabled).toBe(false);
      expect(result.current.showJumpToBottom).toBe(true);
    });

    it("works with string triggerKeys", () => {
      const mockEl = makeMockEl();
      const { result, rerender } = renderHook(
        ({
          contentLength,
          triggerKey,
        }: {
          contentLength: number;
          triggerKey: string;
        }) => useAutoScroll({ contentLength, resetKey: "task-1", triggerKey }),
        { initialProps: { contentLength: 0, triggerKey: "tab-output" } }
      );

      setRef(result, mockEl);

      rerender({ contentLength: 100, triggerKey: "tab-output" });
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(mockEl.scrollTop).toBe(300);

      mockEl.scrollTop = 0;

      // Switch tab
      rerender({ contentLength: 100, triggerKey: "tab-chat" });
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(mockEl.scrollTop).toBe(300);
    });

    it("does not interfere with content-length auto-scroll", () => {
      const mockEl = makeMockEl();
      const { result, rerender } = renderHook(
        ({
          contentLength,
          triggerKey,
        }: {
          contentLength: number;
          triggerKey: number;
        }) => useAutoScroll({ contentLength, resetKey: "task-1", triggerKey }),
        { initialProps: { contentLength: 0, triggerKey: 0 } }
      );

      setRef(result, mockEl);

      // Content grows — should scroll
      rerender({ contentLength: 100, triggerKey: 0 });
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(mockEl.scrollTop).toBe(300);

      mockEl.scrollTop = 0;

      // More content — should scroll again
      rerender({ contentLength: 200, triggerKey: 0 });
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(mockEl.scrollTop).toBe(300);

      mockEl.scrollTop = 0;

      // triggerKey change also scrolls
      rerender({ contentLength: 200, triggerKey: 1 });
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(mockEl.scrollTop).toBe(300);
    });
  });
});
