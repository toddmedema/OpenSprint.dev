import { useIsOffline } from "../hooks/useIsOffline";

/**
 * Shows connection status only when offline. Hidden when server is online and
 * websockets are connected. Debounces the offline state to avoid flicker during
 * initial connect or brief reconnects.
 */
export function ConnectionIndicator() {
  const showOffline = useIsOffline();

  if (!showOffline) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-sm text-theme-error-text">
      <div className="w-2 h-2 rounded-full bg-theme-error-solid" />
      <span>Offline</span>
    </div>
  );
}
