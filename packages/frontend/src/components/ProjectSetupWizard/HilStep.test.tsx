import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HilStep } from "./HilStep";
import { DEFAULT_HIL_CONFIG } from "@opensprint/shared";

describe("HilStep", () => {
  it("renders only configurable HIL categories (PRD §6.5.1: no testFailuresAndRetries)", () => {
    const onChange = vi.fn();
    render(<HilStep value={DEFAULT_HIL_CONFIG} onChange={onChange} />);

    expect(screen.getByText("Scope Changes")).toBeInTheDocument();
    expect(screen.getByText("Architecture Decisions")).toBeInTheDocument();
    expect(screen.getByText("Dependency Modifications")).toBeInTheDocument();
    expect(screen.queryByText(/Test Failures|testFailuresAndRetries/i)).not.toBeInTheDocument();
  });

  it("calls onChange when a category mode is changed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HilStep value={DEFAULT_HIL_CONFIG} onChange={onChange} />);

    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(3);

    await user.selectOptions(selects[0]!, "automated");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        ...DEFAULT_HIL_CONFIG,
        scopeChanges: "automated",
      })
    );
  });
});
