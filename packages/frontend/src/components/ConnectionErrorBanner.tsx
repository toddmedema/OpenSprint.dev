import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppDispatch, useAppSelector } from "../store";
import { CONNECTION_TOAST_MESSAGE_PATTERN } from "../lib/connectionNotificationConstants";
import { setConnectionError, dbStatusRestored } from "../store/slices/connectionSlice";
import { dismissNotification } from "../store/slices/notificationSlice";
import { api } from "../api/client";
import { DB_STATUS_QUERY_KEY } from "../api/hooks/db-status";
import { Banner } from "./notifications";

const MESSAGE = "Failed to connect to Open Sprint server - try restarting it";

/** Poll interval when banner is visible to detect connection recovery. */
const RECOVERY_POLL_MS = 3000;

/** Global, non-closable banner shown when fetch/WebSocket cannot reach the server.
 * When visible, polls the backend; on first success the banner is dismissed automatically.
 * Shows a "Check again" action and countdown so users have a sense of control. */
export function ConnectionErrorBanner() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const connectionError = useAppSelector((s) => s.connection?.connectionError ?? false);
  const notificationItems = useAppSelector((s) => s.notification?.items);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPollAtRef = useRef<number>(0);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState(3);

  const poll = useCallback(() => {
    if (!api.dbStatus?.get) return;
    lastPollAtRef.current = Date.now();
    api.dbStatus
      .get()
      .then((result) => {
        dispatch(setConnectionError(false));
        if (result?.ok) {
          dispatch(dbStatusRestored());
        }
        void queryClient.invalidateQueries({ queryKey: DB_STATUS_QUERY_KEY });
      })
      .catch(() => {
        // Still down; next poll will retry
      });
  }, [dispatch, queryClient]);

  useEffect(() => {
    if (!connectionError) return;
    const items = notificationItems ?? [];
    for (const n of items) {
      if (CONNECTION_TOAST_MESSAGE_PATTERN.test(n.message)) {
        dispatch(dismissNotification(n.id));
      }
    }
  }, [connectionError, notificationItems, dispatch]);

  useEffect(() => {
    if (!connectionError) return;

    poll();
    intervalRef.current = setInterval(poll, RECOVERY_POLL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [connectionError, poll]);

  useEffect(() => {
    if (!connectionError) return;

    const tick = () => {
      const elapsed = Date.now() - lastPollAtRef.current;
      const secondsLeft = Math.max(1, Math.ceil((RECOVERY_POLL_MS - elapsed) / 1000));
      setSecondsUntilNextCheck(secondsLeft);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [connectionError]);

  const handleCheckAgain = () => {
    poll();
    setSecondsUntilNextCheck(3);
  };

  if (!connectionError) return null;

  return (
    <Banner
      severity="error"
      message={MESSAGE}
      testId="connection-error-banner"
      actions={
        <>
          <span className="text-sm opacity-90">Checking again in {secondsUntilNextCheck}s</span>
          <button
            type="button"
            onClick={handleCheckAgain}
            className="rounded px-3 py-1.5 text-sm font-medium bg-theme-error-text/15 hover:bg-theme-error-text/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-error-text/50"
            data-testid="connection-error-check-again"
          >
            Check again
          </button>
        </>
      }
    />
  );
}
