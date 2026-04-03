import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { EvaluateFilterToolbar } from "./EvaluateFilterToolbar";

describe("EvaluateFilterToolbar", () => {
  beforeEach(() => {
    localStorage.setItem("opensprint.theme", "dark");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  it("applies theme surface classes on the phase filter bar in dark mode", async () => {
    const chipConfig = [
      { label: "All", filter: "all" as const, count: 2 },
      { label: "Pending", filter: "pending" as const, count: 1 },
      { label: "Resolved", filter: "resolved" as const, count: 1 },
    ];
    const searchRef = createRef<HTMLInputElement>();

    render(
      <ThemeProvider>
        <EvaluateFilterToolbar
          chipConfig={chipConfig}
          statusFilter="all"
          setStatusFilter={() => {}}
          searchExpanded={false}
          searchInputValue=""
          setSearchInputValue={() => {}}
          searchInputRef={searchRef}
          handleSearchExpand={() => {}}
          handleSearchClose={() => {}}
          handleSearchKeyDown={() => {}}
          viewMode="feedback"
          onViewModeChange={() => {}}
          intakeProviderFilter=""
          setIntakeProviderFilter={() => {}}
          intakeTriageStatusFilter=""
          setIntakeTriageStatusFilter={() => {}}
          intakeSearchQuery=""
          setIntakeSearchQuery={() => {}}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    const bar = screen.getByTestId("eval-feedback-filter-toolbar");
    expect(bar.className).toContain("bg-theme-surface");
    expect(bar.className).toContain("border-theme-border");
    expect(bar.className).toContain("z-20");
    expect(bar.className).toContain("relative");
    expect(bar.className).toContain("[background-clip:padding-box]");

    const segmented = screen.getByTestId("eval-filter-segmented");
    expect(segmented.className).toContain("bg-theme-surface-muted");
  });
});
