import { useState, useEffect } from "react";
import { useAppSelector } from "../store";

const OFFLINE_DEBOUNCE_MS = 600;

/**
 * Returns true when the app is offline (websocket disconnected for at least
 * OFFLINE_DEBOUNCE_MS). Matches the logic used by ConnectionIndicator so
 * callers can hide UI that depends on connectivity (e.g. agent dropdown)
 * when the offline indicator would be shown.
 */
export function useIsOffline(): boolean {
  const connected = useAppSelector((s) => s.websocket.connected);
  const [showOffline, setShowOffline] = useState(false);

  useEffect(() => {
    if (connected) {
      setShowOffline(false);
      return;
    }
    const timer = setTimeout(() => setShowOffline(true), OFFLINE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [connected]);

  return showOffline;
}
