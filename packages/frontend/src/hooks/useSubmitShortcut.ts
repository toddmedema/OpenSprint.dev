import { useCallback } from "react";

export interface UseSubmitShortcutOptions {
  /** If true, only Cmd/Ctrl+Enter submits; plain Enter inserts newline. If false, Enter (no Shift) and Cmd/Ctrl+Enter both submit. Default: false (single-line). */
  multiline?: boolean;
  /** When true, the shortcut does nothing. */
  disabled?: boolean;
}

/**
 * Returns an onKeyDown handler that submits on Cmd+Enter (macOS) or Ctrl+Enter (Windows/Linux).
 * - For multiline inputs (textarea): Cmd/Ctrl+Enter submits; plain Enter inserts newline.
 * - For single-line inputs: Enter (without Shift) and Cmd/Ctrl+Enter both submit.
 */
export function useSubmitShortcut(
  onSubmit: () => void,
  options?: UseSubmitShortcutOptions
): (e: React.KeyboardEvent) => void {
  const { multiline = false, disabled = false } = options ?? {};

  return useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key !== "Enter") return;

      const isMod = e.metaKey || e.ctrlKey;

      if (multiline) {
        if (isMod) {
          e.preventDefault();
          onSubmit();
        }
        // else: allow default (insert newline)
      } else {
        if (isMod || !e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      }
    },
    [onSubmit, multiline, disabled]
  );
}
