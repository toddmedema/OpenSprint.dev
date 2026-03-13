import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./SegmentedControl";

describe("SegmentedControl", () => {
  it("renders options and marks the active one", () => {
    render(
      <SegmentedControl
        value="all"
        onChange={vi.fn()}
        options={[
          { value: "all", label: "All", count: 3, testId: "seg-all" },
          { value: "ready", label: "Ready", count: 1, testId: "seg-ready" },
        ]}
      />
    );

    expect(screen.getByTestId("seg-all")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("seg-ready")).toHaveAttribute("aria-checked", "false");
  });

  it("has visible focus-visible ring for keyboard navigation", () => {
    render(
      <SegmentedControl
        value="all"
        onChange={vi.fn()}
        options={[
          { value: "all", label: "All", testId: "seg-all" },
          { value: "ready", label: "Ready", testId: "seg-ready" },
        ]}
      />
    );
    const btn = screen.getByTestId("seg-ready");
    expect(btn).toHaveClass(
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-brand-500"
    );
  });

  it("calls onChange when a new option is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="all"
        onChange={onChange}
        options={[
          { value: "all", label: "All", testId: "seg-all" },
          { value: "ready", label: "Ready", testId: "seg-ready" },
        ]}
      />
    );

    await user.click(screen.getByTestId("seg-ready"));
    expect(onChange).toHaveBeenCalledWith("ready");
  });
});
