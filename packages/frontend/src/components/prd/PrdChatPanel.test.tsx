import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrdChatPanel } from "./PrdChatPanel";

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  messages: [],
  sending: false,
  error: null,
  onDismissError: vi.fn(),
  selectionContext: null,
  onClearSelectionContext: vi.fn(),
  onSend: vi.fn(),
};

describe("PrdChatPanel", () => {
  it("renders Close button (X icon) in header when open", () => {
    render(<PrdChatPanel {...defaultProps} />);

    const closeBtn = screen.getByRole("button", { name: "Close" });
    expect(closeBtn).toBeInTheDocument();
  });

  it("calls onOpenChange and onClearSelectionContext when Close is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onClearSelectionContext = vi.fn();
    render(
      <PrdChatPanel
        {...defaultProps}
        onOpenChange={onOpenChange}
        onClearSelectionContext={onClearSelectionContext}
      />
    );

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onClearSelectionContext).toHaveBeenCalled();
  });

  it("renders Clear selection button when selectionContext is set", () => {
    render(
      <PrdChatPanel
        {...defaultProps}
        selectionContext={{ text: "Some text", section: "executive_summary" }}
      />
    );

    const clearBtn = screen.getByRole("button", { name: "Clear selection" });
    expect(clearBtn).toBeInTheDocument();
  });
});
