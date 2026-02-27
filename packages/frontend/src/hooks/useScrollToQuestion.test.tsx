import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLocation, MemoryRouter } from "react-router-dom";
import { useScrollToQuestion } from "./useScrollToQuestion";

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useLocation: vi.fn(),
  };
});

const mockUseLocation = vi.mocked(useLocation);

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useScrollToQuestion", () => {
  const mockScrollIntoView = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mockScrollIntoView.mockClear();
    Element.prototype.scrollIntoView = mockScrollIntoView;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when question param is absent", () => {
    mockUseLocation.mockReturnValue({
      search: "",
      pathname: "/projects/p1/plan",
      state: null,
      key: "default",
      hash: "",
    });

    renderHook(() => useScrollToQuestion(), { wrapper });
    vi.advanceTimersByTime(200);

    expect(mockScrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls to element with matching data-question-id when question param is present", () => {
    mockUseLocation.mockReturnValue({
      search: "?plan=p1&question=notif-xyz",
      pathname: "/projects/p1/plan",
      state: null,
      key: "default",
      hash: "",
    });

    const el = document.createElement("div");
    el.setAttribute("data-question-id", "notif-xyz");
    document.body.appendChild(el);

    renderHook(() => useScrollToQuestion(), { wrapper });
    vi.advanceTimersByTime(200);

    expect(mockScrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });

    document.body.removeChild(el);
  });

  it("does not scroll when no matching element exists", () => {
    mockUseLocation.mockReturnValue({
      search: "?question=notif-nonexistent",
      pathname: "/projects/p1/plan",
      state: null,
      key: "default",
      hash: "",
    });

    renderHook(() => useScrollToQuestion(), { wrapper });
    vi.advanceTimersByTime(200);

    expect(mockScrollIntoView).not.toHaveBeenCalled();
  });
});
