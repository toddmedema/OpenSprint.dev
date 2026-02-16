import { useState, useEffect } from 'react';
import { useAppSelector } from '../store';

const OFFLINE_DEBOUNCE_MS = 600;

/**
 * Shows connection status only when offline. Hidden when server is online and
 * websockets are connected. Debounces the offline state to avoid flicker during
 * initial connect or brief reconnects.
 */
export function ConnectionIndicator() {
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

  if (!showOffline) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-sm text-red-600">
      <div className="w-2 h-2 rounded-full bg-red-500" />
      <span>Offline</span>
    </div>
  );
}
