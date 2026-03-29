import { useRef, useState, useEffect, useCallback } from "react";

const BOTTOM_THRESHOLD_PX = 50;

export interface UseAutoScrollOptions {
  /** Content length (e.g. agentOutput.length) - when this increases and auto-scroll is on, scroll to bottom */
  contentLength: number;
  /** Key that resets auto-scroll when changed (e.g. selectedTask) */
  resetKey: string;
  /**
   * When this key changes and auto-scroll is enabled, scroll to bottom
   * without resetting user scroll-up state. Useful for tab/section visibility
   * changes where the container becomes visible and should catch up.
   */
  triggerKey?: string | number;
}

export interface UseAutoScrollResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  autoScrollEnabled: boolean;
  showJumpToBottom: boolean;
  jumpToBottom: () => void;
  handleScroll: () => void;
}

function scrollToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight - el.clientHeight;
}

/**
 * Manages auto-scroll behavior for a scrollable container:
 * - On open/reopen: starts pinned at the latest content
 * - Scrolls to bottom when content grows while auto-scroll is enabled
 * - Disables when user scrolls up (away from bottom)
 * - Re-enables when user scrolls to bottom (within threshold) or clicks Jump to bottom
 * - Resets when resetKey changes (e.g. switching tasks)
 */
export function useAutoScroll({
  contentLength,
  resetKey,
  triggerKey,
}: UseAutoScrollOptions): UseAutoScrollResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const prevContentLengthRef = useRef(0);
  const prevResetKeyRef = useRef(resetKey);
  const prevTriggerKeyRef = useRef(triggerKey);

  // Reset auto-scroll when switching tasks/sessions.
  // Clearing prevContentLengthRef ensures existing content triggers
  // a scroll-to-bottom via the content effect below. We also schedule
  // an immediate scroll so the new task starts at the bottom even when
  // autoScrollEnabled was false (user had scrolled up on the prior task).
  useEffect(() => {
    if (prevResetKeyRef.current !== resetKey) {
      prevResetKeyRef.current = resetKey;
      prevContentLengthRef.current = 0;
      setAutoScrollEnabled(true);
      setShowJumpToBottom(false);
      const el = containerRef.current;
      if (el) {
        const rafId = requestAnimationFrame(() => scrollToBottom(el));
        return () => cancelAnimationFrame(rafId);
      }
    }
  }, [resetKey]);

  // When triggerKey changes and auto-scroll is enabled, scroll to bottom.
  // Unlike resetKey, this preserves user scroll-up state — it only scrolls
  // if the user hasn't intentionally scrolled away.
  useEffect(() => {
    if (triggerKey === undefined || triggerKey === prevTriggerKeyRef.current) return;
    prevTriggerKeyRef.current = triggerKey;
    if (!autoScrollEnabled) return;
    const el = containerRef.current;
    if (!el) return;
    const rafId = requestAnimationFrame(() => {
      scrollToBottom(el);
    });
    return () => cancelAnimationFrame(rafId);
  }, [triggerKey, autoScrollEnabled]);

  // Scroll to bottom when content grows and auto-scroll is enabled.
  // On initial mount or after reset, prevContentLengthRef is 0 so any
  // existing content triggers scroll-to-bottom automatically.
  // When auto-scroll is disabled we intentionally leave prevContentLengthRef
  // stale so that re-enabling it still detects "new" content.
  useEffect(() => {
    if (!autoScrollEnabled) return;
    if (contentLength <= prevContentLengthRef.current) {
      prevContentLengthRef.current = contentLength;
      return;
    }
    prevContentLengthRef.current = contentLength;

    const el = containerRef.current;
    if (!el) return;

    const rafId = requestAnimationFrame(() => {
      scrollToBottom(el);
    });
    return () => cancelAnimationFrame(rafId);
  }, [contentLength, autoScrollEnabled]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    if (distanceFromBottom <= BOTTOM_THRESHOLD_PX) {
      setAutoScrollEnabled(true);
      setShowJumpToBottom(false);
    } else {
      setAutoScrollEnabled(false);
      setShowJumpToBottom(true);
    }
  }, []);

  const jumpToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const rafId = requestAnimationFrame(() => {
      scrollToBottom(el);
      setAutoScrollEnabled(true);
      setShowJumpToBottom(false);
    });
    return () => cancelAnimationFrame(rafId);
  }, []);

  return {
    containerRef,
    autoScrollEnabled,
    showJumpToBottom,
    jumpToBottom,
    handleScroll,
  };
}
