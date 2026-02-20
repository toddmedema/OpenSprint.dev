import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyboardShortcutTooltip } from "./KeyboardShortcutTooltip";

describe("KeyboardShortcutTooltip", () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { ...originalNavigator });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.stubGlobal("navigator", originalNavigator);
  });

  it("does not show tooltip before hover delay", async () => {
    vi.stubGlobal("navigator", {
      ...originalNavigator,
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <KeyboardShortcutTooltip>
        <button type="button">Submit</button>
      </KeyboardShortcutTooltip>
    );

    const button = screen.getByRole("button", { name: "Submit" });
    await user.hover(button);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    vi.advanceTimersByTime(200);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows Ctrl + Enter tooltip after hover delay on Windows", async () => {
    vi.stubGlobal("navigator", {
      ...originalNavigator,
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <KeyboardShortcutTooltip>
        <button type="button">Submit</button>
      </KeyboardShortcutTooltip>
    );

    const button = screen.getByRole("button", { name: "Submit" });
    await user.hover(button);
    vi.advanceTimersByTime(300);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("Ctrl + Enter to submit");
  });

  it("shows Cmd + Enter tooltip after hover delay on macOS", async () => {
    vi.stubGlobal("navigator", {
      ...originalNavigator,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <KeyboardShortcutTooltip>
        <button type="button">Submit</button>
      </KeyboardShortcutTooltip>
    );

    const button = screen.getByRole("button", { name: "Submit" });
    await user.hover(button);
    vi.advanceTimersByTime(300);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("Cmd + Enter to submit");
  });

  it("dismisses tooltip on mouse leave", async () => {
    vi.stubGlobal("navigator", {
      ...originalNavigator,
      platform: "Win32",
      userAgent: "Mozilla/5.0",
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <KeyboardShortcutTooltip>
        <button type="button">Submit</button>
      </KeyboardShortcutTooltip>
    );

    const button = screen.getByRole("button", { name: "Submit" });
    await user.hover(button);
    vi.advanceTimersByTime(300);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await user.unhover(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not interfere with button click", async () => {
    const onClick = vi.fn();
    vi.stubGlobal("navigator", {
      ...originalNavigator,
      platform: "Win32",
      userAgent: "Mozilla/5.0",
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <KeyboardShortcutTooltip>
        <button type="button" onClick={onClick}>
          Submit
        </button>
      </KeyboardShortcutTooltip>
    );

    const button = screen.getByRole("button", { name: "Submit" });
    await user.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
