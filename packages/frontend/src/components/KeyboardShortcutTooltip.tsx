import { useState, useRef, useCallback, useEffect } from "react";
import { getSubmitShortcutLabel } from "../utils/platform";

const HOVER_DELAY_MS = 300;

export interface KeyboardShortcutTooltipProps {
  children: React.ReactNode;
}

/**
 * Wraps the Submit Feedback button. On hover, shows a tooltip with the
 * OS-aware keyboard shortcut (Cmd + Enter on macOS, Ctrl + Enter elsewhere)
 * after a short delay. Tooltip does not interfere with clicking.
 */
export function KeyboardShortcutTooltip({ children }: KeyboardShortcutTooltipProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const hideTooltip = useCallback(() => {
    clearTimer();
    setTooltipVisible(false);
  }, [clearTimer]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  const handleMouseEnter = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => setTooltipVisible(true), HOVER_DELAY_MS);
  }, []);

  const handleMouseLeave = useCallback(() => {
    hideTooltip();
  }, [hideTooltip]);

  const shortcutLabel = getSubmitShortcutLabel();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {tooltipVisible && (
        <div
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1.5 text-xs font-normal
            bg-theme-bg-elevated text-theme-text rounded-lg shadow-lg ring-1 ring-theme-border
            whitespace-nowrap z-50 pointer-events-none
            animate-fade-in"
        >
          {shortcutLabel}
        </div>
      )}
    </span>
  );
}
