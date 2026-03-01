import { useState, useEffect, useRef } from "react";

/** Delay before showing empty state when fetch completes with empty data (avoids flash) */
export const PHASE_EMPTY_DELAY_MS = 300;

/**
 * Returns { showSpinner, showEmptyState } for phase pages:
 * - During fetch: showSpinner=true, showEmptyState=false
 * - After fetch with data: showSpinner=false, showEmptyState=false
 * - After fetch with empty: wait PHASE_EMPTY_DELAY_MS, then showEmptyState=true
 */
export function usePhaseLoadingState(
  isLoading: boolean,
  isEmpty: boolean,
  delayMs: number = PHASE_EMPTY_DELAY_MS
): { showSpinner: boolean; showEmptyState: boolean } {
  const [showEmptyState, setShowEmptyState] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setShowEmptyState(false);
      return;
    }

    if (!isEmpty) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setShowEmptyState(false);
      return;
    }

    // Fetch completed with empty data: wait delayMs before showing empty state
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setShowEmptyState(true);
    }, delayMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isLoading, isEmpty, delayMs]);

  /* During 300ms delay after empty fetch, keep showing spinner to avoid flash */
  const inEmptyDelay = !isLoading && isEmpty && !showEmptyState;

  return {
    showSpinner: isLoading || inEmptyDelay,
    showEmptyState: !isLoading && isEmpty && showEmptyState,
  };
}
