import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { ExecuteFilterToolbar } from "./ExecuteFilterToolbar";
import type { StatusFilter } from "../../lib/executeTaskFilter";

describe("ExecuteFilterToolbar", () => {
  beforeEach(() => {
    localStorage.setItem("opensprint.theme", "dark");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  it("applies theme surface classes on the phase filter bar in dark mode", async () => {
    const chipConfig: { label: string; filter: StatusFilter; count: number }[] = [
      { label: "All", filter: "all", count: 2 },
      { label: "In Progress", filter: "in_progress", count: 1 },
      { label: "Ready", filter: "ready", count: 1 },
      { label: "Done", filter: "done", count: 0 },
    ];
    const searchRef = createRef<HTMLInputElement>();

    render(
      <ThemeProvider>
        <ExecuteFilterToolbar
          chipConfig={chipConfig}
          statusFilter="all"
          setStatusFilter={() => {}}
          awaitingApproval={false}
          searchExpanded={false}
          searchInputValue=""
          setSearchInputValue={() => {}}
          searchInputRef={searchRef}
          handleSearchExpand={() => {}}
          handleSearchClose={() => {}}
          handleSearchKeyDown={() => {}}
          viewMode="timeline"
          onViewModeChange={() => {}}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    const bar = screen.getByTestId("execute-filter-toolbar");
    expect(bar.className).toContain("bg-theme-surface");
    expect(bar.className).toContain("border-theme-border");

    const segmented = screen.getByTestId("execute-filter-segmented");
    expect(segmented.className).toContain("bg-theme-surface-muted");
  });
});
