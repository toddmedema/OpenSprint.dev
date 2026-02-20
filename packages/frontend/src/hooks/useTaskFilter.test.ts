import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTaskFilter } from "./useTaskFilter";

describe("useTaskFilter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns default state", () => {
    const { result } = renderHook(() => useTaskFilter());

    expect(result.current.statusFilter).toBe("all");
    expect(result.current.searchExpanded).toBe(false);
    expect(result.current.searchInputValue).toBe("");
    expect(result.current.searchQuery).toBe("");
    expect(result.current.isSearchActive).toBe(false);
  });

  it("updates statusFilter when setStatusFilter is called", () => {
    const { result } = renderHook(() => useTaskFilter());

    act(() => {
      result.current.setStatusFilter("done");
    });

    expect(result.current.statusFilter).toBe("done");
  });

  it("expands search when handleSearchExpand is called", () => {
    const { result } = renderHook(() => useTaskFilter());

    act(() => {
      result.current.handleSearchExpand();
    });

    expect(result.current.searchExpanded).toBe(true);
  });

  it("closes and clears search when handleSearchClose is called", () => {
    const { result } = renderHook(() => useTaskFilter());

    act(() => {
      result.current.setSearchInputValue("foo");
      result.current.handleSearchExpand();
    });

    act(() => {
      result.current.handleSearchClose();
    });

    expect(result.current.searchExpanded).toBe(false);
    expect(result.current.searchInputValue).toBe("");
    expect(result.current.searchQuery).toBe("");
  });

  it("debounces search query from input value", () => {
    const { result } = renderHook(() => useTaskFilter());

    act(() => {
      result.current.setSearchInputValue("login");
    });

    expect(result.current.searchQuery).toBe("");

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.searchQuery).toBe("login");
    expect(result.current.isSearchActive).toBe(true);
  });

  it("clears search query immediately when input is empty", () => {
    const { result } = renderHook(() => useTaskFilter());

    act(() => {
      result.current.setSearchInputValue("foo");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.searchQuery).toBe("foo");

    act(() => {
      result.current.setSearchInputValue("");
    });

    expect(result.current.searchQuery).toBe("");
  });
});
