import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSubmitShortcut } from "./useSubmitShortcut";

function createKeyDownEvent(overrides: Partial<React.KeyboardEvent> = {}): React.KeyboardEvent {
  return {
    key: "Enter",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as React.KeyboardEvent;
}

describe("useSubmitShortcut", () => {
  it("single-line: Enter triggers submit", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useSubmitShortcut(onSubmit, { multiline: false }));

    const e = createKeyDownEvent({ key: "Enter", shiftKey: false });
    result.current(e);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("single-line: Cmd+Enter triggers submit", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useSubmitShortcut(onSubmit, { multiline: false }));

    const e = createKeyDownEvent({ key: "Enter", metaKey: true });
    result.current(e);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("single-line: Ctrl+Enter triggers submit", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useSubmitShortcut(onSubmit, { multiline: false }));

    const e = createKeyDownEvent({ key: "Enter", ctrlKey: true });
    result.current(e);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("single-line: Shift+Enter does not trigger submit", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useSubmitShortcut(onSubmit, { multiline: false }));

    const e = createKeyDownEvent({ key: "Enter", shiftKey: true });
    result.current(e);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("multiline: Cmd+Enter triggers submit", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useSubmitShortcut(onSubmit, { multiline: true }));

    const e = createKeyDownEvent({ key: "Enter", metaKey: true });
    result.current(e);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("multiline: Ctrl+Enter triggers submit", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useSubmitShortcut(onSubmit, { multiline: true }));

    const e = createKeyDownEvent({ key: "Enter", ctrlKey: true });
    result.current(e);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("multiline: plain Enter does not trigger submit", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useSubmitShortcut(onSubmit, { multiline: true }));

    const e = createKeyDownEvent({ key: "Enter", metaKey: false, ctrlKey: false });
    result.current(e);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("non-Enter key does nothing", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useSubmitShortcut(onSubmit));

    const e = createKeyDownEvent({ key: "a" });
    result.current(e);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("disabled: Cmd+Enter does not trigger submit", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useSubmitShortcut(onSubmit, { multiline: true, disabled: true })
    );

    const e = createKeyDownEvent({ key: "Enter", metaKey: true });
    result.current(e);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("disabled: Enter does not trigger submit (single-line)", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useSubmitShortcut(onSubmit, { multiline: false, disabled: true })
    );

    const e = createKeyDownEvent({ key: "Enter" });
    result.current(e);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
