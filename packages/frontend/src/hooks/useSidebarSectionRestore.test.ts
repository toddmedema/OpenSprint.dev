import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useSidebarSectionRestore,
  toStableKey,
  SIDEBAR_SECTION_KEYS,
} from "./useSidebarSectionRestore";
import type { RefObject } from "react";

function makeScrollContainer(sectionIds: string[]): HTMLDivElement {
  const div = document.createElement("div");
  for (const id of sectionIds) {
    const section = document.createElement("div");
    section.setAttribute("data-sidebar-section-id", id);
    div.appendChild(section);
  }
  return div;
}

describe("toStableKey", () => {
  it("returns the id unchanged for fixed section keys", () => {
    expect(toStableKey(SIDEBAR_SECTION_KEYS.DESCRIPTION)).toBe(
      SIDEBAR_SECTION_KEYS.DESCRIPTION
    );
    expect(toStableKey(SIDEBAR_SECTION_KEYS.ARTIFACTS)).toBe(SIDEBAR_SECTION_KEYS.ARTIFACTS);
    expect(toStableKey(SIDEBAR_SECTION_KEYS.CHAT)).toBe(SIDEBAR_SECTION_KEYS.CHAT);
    expect(toStableKey(SIDEBAR_SECTION_KEYS.DIAGNOSTICS)).toBe(
      SIDEBAR_SECTION_KEYS.DIAGNOSTICS
    );
  });

  it("maps source-feedback-* ids to a single stable key", () => {
    expect(toStableKey("source-feedback-abc123")).toBe("source-feedback");
    expect(toStableKey("source-feedback-xyz")).toBe("source-feedback");
  });

  it("does not map unrelated ids", () => {
    expect(toStableKey("some-other-section")).toBe("some-other-section");
  });
});

describe("useSidebarSectionRestore", () => {
  let rafCallbacks: Array<FrameRequestCallback>;
  let rafId: number;

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushRaf() {
    const cbs = rafCallbacks.splice(0);
    for (const cb of cbs) cb(performance.now());
  }

  it("returns a stable handleActiveSectionChange callback", () => {
    const container = makeScrollContainer([SIDEBAR_SECTION_KEYS.ARTIFACTS]);
    const ref = { current: container } as RefObject<HTMLDivElement>;

    const { result, rerender } = renderHook(() =>
      useSidebarSectionRestore({ scrollContainerRef: ref, selectedTask: "task-1" })
    );

    const first = result.current.handleActiveSectionChange;
    rerender();
    expect(result.current.handleActiveSectionChange).toBe(first);
  });

  it("scrolls to the previously active section after task switch", () => {
    const container = makeScrollContainer([
      SIDEBAR_SECTION_KEYS.DESCRIPTION,
      SIDEBAR_SECTION_KEYS.ARTIFACTS,
      SIDEBAR_SECTION_KEYS.CHAT,
    ]);

    const artifactsEl = container.querySelector(
      `[data-sidebar-section-id="${SIDEBAR_SECTION_KEYS.ARTIFACTS}"]`
    ) as HTMLElement;
    artifactsEl.scrollIntoView = vi.fn();

    const ref = { current: container } as RefObject<HTMLDivElement>;

    const { result, rerender } = renderHook(
      ({ task }) =>
        useSidebarSectionRestore({ scrollContainerRef: ref, selectedTask: task }),
      { initialProps: { task: "task-1" } }
    );

    act(() => {
      result.current.handleActiveSectionChange(SIDEBAR_SECTION_KEYS.ARTIFACTS);
    });

    rerender({ task: "task-2" });

    act(() => flushRaf());

    expect(artifactsEl.scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
    });
  });

  it("falls back to first available section when target is absent", () => {
    const container = makeScrollContainer([
      SIDEBAR_SECTION_KEYS.DIAGNOSTICS,
      SIDEBAR_SECTION_KEYS.CHAT,
    ]);

    const diagnosticsEl = container.querySelector(
      `[data-sidebar-section-id="${SIDEBAR_SECTION_KEYS.DIAGNOSTICS}"]`
    ) as HTMLElement;
    diagnosticsEl.scrollIntoView = vi.fn();

    const ref = { current: container } as RefObject<HTMLDivElement>;

    const { result, rerender } = renderHook(
      ({ task }) =>
        useSidebarSectionRestore({ scrollContainerRef: ref, selectedTask: task }),
      { initialProps: { task: "task-1" } }
    );

    act(() => {
      result.current.handleActiveSectionChange(SIDEBAR_SECTION_KEYS.DESCRIPTION);
    });

    rerender({ task: "task-2" });

    act(() => flushRaf());

    expect(diagnosticsEl.scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
    });
  });

  it("scrolls to top when no sections exist in new task", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "scrollTop", { writable: true, value: 200 });
    const ref = { current: container } as RefObject<HTMLDivElement>;

    const { result, rerender } = renderHook(
      ({ task }) =>
        useSidebarSectionRestore({ scrollContainerRef: ref, selectedTask: task }),
      { initialProps: { task: "task-1" } }
    );

    act(() => {
      result.current.handleActiveSectionChange(SIDEBAR_SECTION_KEYS.ARTIFACTS);
    });

    rerender({ task: "task-2" });

    act(() => flushRaf());

    expect(container.scrollTop).toBe(0);
  });

  it("maps source-feedback section to first available feedback in new task", () => {
    const container = makeScrollContainer([
      SIDEBAR_SECTION_KEYS.DESCRIPTION,
      "source-feedback-new-id",
      SIDEBAR_SECTION_KEYS.CHAT,
    ]);

    const feedbackEl = container.querySelector(
      '[data-sidebar-section-id="source-feedback-new-id"]'
    ) as HTMLElement;
    feedbackEl.scrollIntoView = vi.fn();

    const ref = { current: container } as RefObject<HTMLDivElement>;

    const { result, rerender } = renderHook(
      ({ task }) =>
        useSidebarSectionRestore({ scrollContainerRef: ref, selectedTask: task }),
      { initialProps: { task: "task-1" } }
    );

    act(() => {
      result.current.handleActiveSectionChange("source-feedback-old-id");
    });

    rerender({ task: "task-2" });

    act(() => flushRaf());

    expect(feedbackEl.scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
    });
  });

  it("does not scroll when task stays the same", () => {
    const container = makeScrollContainer([SIDEBAR_SECTION_KEYS.ARTIFACTS]);

    const el = container.querySelector(
      `[data-sidebar-section-id="${SIDEBAR_SECTION_KEYS.ARTIFACTS}"]`
    ) as HTMLElement;
    el.scrollIntoView = vi.fn();

    const ref = { current: container } as RefObject<HTMLDivElement>;

    const { result, rerender } = renderHook(
      ({ task }) =>
        useSidebarSectionRestore({ scrollContainerRef: ref, selectedTask: task }),
      { initialProps: { task: "task-1" } }
    );

    act(() => {
      result.current.handleActiveSectionChange(SIDEBAR_SECTION_KEYS.ARTIFACTS);
    });

    rerender({ task: "task-1" });

    act(() => flushRaf());

    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll when no section was active before switch", () => {
    const container = makeScrollContainer([SIDEBAR_SECTION_KEYS.ARTIFACTS]);
    Object.defineProperty(container, "scrollTop", { writable: true, value: 100 });

    const ref = { current: container } as RefObject<HTMLDivElement>;

    const { rerender } = renderHook(
      ({ task }) =>
        useSidebarSectionRestore({ scrollContainerRef: ref, selectedTask: task }),
      { initialProps: { task: "task-1" } }
    );

    rerender({ task: "task-2" });

    act(() => flushRaf());

    expect(container.scrollTop).toBe(100);
  });

  it("handles null scrollContainerRef gracefully", () => {
    const ref = { current: null } as RefObject<HTMLDivElement>;

    const { result, rerender } = renderHook(
      ({ task }) =>
        useSidebarSectionRestore({ scrollContainerRef: ref, selectedTask: task }),
      { initialProps: { task: "task-1" } }
    );

    act(() => {
      result.current.handleActiveSectionChange(SIDEBAR_SECTION_KEYS.ARTIFACTS);
    });

    rerender({ task: "task-2" });
    act(() => flushRaf());
  });
});
