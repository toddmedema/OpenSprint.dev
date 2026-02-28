import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HilStep } from "./HilStep";
import { DEFAULT_AI_AUTONOMY_LEVEL } from "@opensprint/shared";

describe("HilStep", () => {
  it("defaults to full autonomy when using DEFAULT_AI_AUTONOMY_LEVEL", () => {
    const onChange = vi.fn();
    render(<HilStep value={DEFAULT_AI_AUTONOMY_LEVEL} onChange={onChange} />);

    const slider = screen.getByTestId("ai-autonomy-slider");
    expect(slider).toHaveValue("2"); // full is index 2
  });

  it("renders AI Autonomy slider with three levels", () => {
    const onChange = vi.fn();
    render(<HilStep value="full" onChange={onChange} />);

    expect(screen.getByText("Confirm all scope changes")).toBeInTheDocument();
    expect(screen.getByText("Major scope changes only")).toBeInTheDocument();
    expect(screen.getByText("Full autonomy")).toBeInTheDocument();
  });

  it("calls onChange when slider is moved", () => {
    const onChange = vi.fn();
    render(<HilStep value="full" onChange={onChange} />);

    const slider = screen.getByTestId("ai-autonomy-slider");
    fireEvent.change(slider, { target: { value: "0" } });

    expect(onChange).toHaveBeenCalledWith("confirm_all");
  });
});
