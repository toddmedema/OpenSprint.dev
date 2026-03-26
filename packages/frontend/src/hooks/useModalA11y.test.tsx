import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { useModalA11y } from "./useModalA11y";

/** jsdom often reports offsetParent as null; getFocusableElements skips those nodes. */
const offsetParentDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return (this as HTMLElement).parentElement ?? document.body;
    },
  });
});
afterAll(() => {
  if (offsetParentDesc) {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParentDesc);
  }
});

function TestModal({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y({ containerRef, onClose, isOpen: true });

  return (
    <div role="dialog" ref={containerRef} aria-modal="true" aria-label="Test modal">
      <button type="button" onClick={onClose}>
        Close
      </button>
      <button type="button">Action</button>
    </div>
  );
}

function TestModalWithInitialFocus({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  useModalA11y({ containerRef, onClose, isOpen: true, initialFocusRef: actionRef });

  return (
    <div role="dialog" ref={containerRef} aria-modal="true" aria-label="Test modal">
      <button type="button" onClick={onClose}>
        Close
      </button>
      <button type="button" ref={actionRef}>
        Action
      </button>
    </div>
  );
}

describe("useModalA11y", () => {
  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<TestModal onClose={onClose} />);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses initialFocusRef instead of the first focusable control", async () => {
    render(<TestModalWithInitialFocus onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Action" })).toHaveFocus();
    });
  });

  it("wraps Tab from last to first focusable inside the modal", () => {
    render(<TestModal onClose={vi.fn()} />);

    const closeBtn = screen.getByRole("button", { name: "Close" });
    const actionBtn = screen.getByRole("button", { name: "Action" });

    actionBtn.focus();
    fireEvent.keyDown(actionBtn, { key: "Tab", bubbles: true, cancelable: true });
    expect(closeBtn).toHaveFocus();
  });

  it("wraps Shift+Tab from first to last focusable inside the modal", () => {
    render(<TestModal onClose={vi.fn()} />);

    const closeBtn = screen.getByRole("button", { name: "Close" });
    const actionBtn = screen.getByRole("button", { name: "Action" });

    closeBtn.focus();
    fireEvent.keyDown(closeBtn, {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    expect(actionBtn).toHaveFocus();
  });
});
