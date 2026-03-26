import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddPlanModal } from "./AddPlanModal";
import { planIdeaDraftStorageKey } from "../../lib/agentInputDraftStorage";

const defaultProjectId = "proj-test";

async function expectFeatureInputFocused() {
  await waitFor(() => {
    expect(screen.getByTestId("feature-description-input")).toHaveFocus();
  });
}

describe("AddPlanModal", () => {
  beforeEach(() => {
    localStorage.removeItem(planIdeaDraftStorageKey(defaultProjectId));
  });

  it("focuses the feature description field when opened", async () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(false);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    await expectFeatureInputFocused();
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(false);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: /add plan/i });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when overlay (backdrop) is clicked", () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(false);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const overlay = document.querySelector(".bg-theme-overlay");
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(false);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const closeButton = screen.getByRole("button", { name: /close add plan modal/i });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onGenerate with trimmed description and closes immediately", () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(true);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const input = screen.getByTestId("feature-description-input");
    fireEvent.change(input, { target: { value: "  Add dark mode  " } });

    const generateButton = screen.getByTestId("generate-plan-button");
    fireEvent.click(generateButton);

    expect(onGenerate).toHaveBeenCalledWith("Add dark mode");
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes immediately even when onGenerate would resolve false", () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(false);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const input = screen.getByTestId("feature-description-input");
    fireEvent.change(input, { target: { value: "Feature text" } });
    fireEvent.click(screen.getByTestId("generate-plan-button"));

    expect(onGenerate).toHaveBeenCalledWith("Feature text");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onGenerate when Generate Plan is clicked with empty input", () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(true);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const generateButton = screen.getByTestId("generate-plan-button");
    expect(generateButton).toBeDisabled();
    fireEvent.click(generateButton);

    expect(onGenerate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
