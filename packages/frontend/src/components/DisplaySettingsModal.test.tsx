// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DisplaySettingsModal } from "./DisplaySettingsModal";

vi.mock("./GlobalSettingsContent", () => ({
  GlobalSettingsContent: () => <div data-testid="global-settings-stub">Settings body</div>,
}));

describe("DisplaySettingsModal", () => {
  it("exposes dialog semantics and closes on Escape", () => {
    const onClose = vi.fn();
    render(<DisplaySettingsModal onClose={onClose} />);

    const dialog = screen.getByTestId("display-settings-modal");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
