import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppDispatch, useAppSelector } from "../store";
import { setConnectionError } from "../store/slices/connectionSlice";
import { api } from "../api/client";
import { DB_STATUS_QUERY_KEY } from "../api/hooks/db-status";

const MESSAGE = "Failed to connect to Open Sprint server - try restarting it";

/** Poll interval when banner is visible to detect connection recovery. */
const RECOVERY_POLL_MS = 3000;

/** Global, non-closable banner shown when fetch/WebSocket cannot reach the server.
 * When visible, polls the backend; on first success the banner is dismissed automatically. */
export function ConnectionErrorBanner() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const connectionError = useAppSelector((s) => s.connection?.connectionError ?? false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!connectionError) return;

    const poll = () => {
      if (!api.dbStatus?.get) return;
      api.dbStatus
        .get()
        .then(() => {
          dispatch(setConnectionError(false));
          void queryClient.invalidateQueries({ queryKey: DB_STATUS_QUERY_KEY });
        })
        .catch(() => {
          // Still down; next poll will retry
        });
    };

    poll();
    intervalRef.current = setInterval(poll, RECOVERY_POLL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [connectionError, dispatch, queryClient]);

  if (!connectionError) return null;

  return (
    <div
      className="flex items-center justify-center bg-theme-error-bg px-4 py-3 text-theme-error-text border-b border-theme-error-border shrink-0"
      data-testid="connection-error-banner"
      role="alert"
    >
      <p className="text-sm font-medium">{MESSAGE}</p>
    </div>
  );
}
