import { useEffect, useRef } from "react";
import { Link, useMatch } from "react-router-dom";
import { useDbStatus } from "../api/hooks";
import { useAppSelector, useAppDispatch } from "../store";
import { CONNECTION_TOAST_MESSAGE_PATTERN } from "../lib/connectionNotificationConstants";
import { dbStatusRestored } from "../store/slices/connectionSlice";
import { dismissNotification } from "../store/slices/notificationSlice";
import { Banner } from "./notifications";

export function DatabaseStatusBanner() {
  const dispatch = useAppDispatch();
  const connectionError = useAppSelector((s) => s.connection?.connectionError ?? false);
  const notificationItems = useAppSelector((s) => s.notification?.items);
  const { data } = useDbStatus();
  const projectMatch = useMatch("/projects/:projectId/*");
  const prevOkRef = useRef<boolean | null>(null);

  const isVisible = !connectionError && data && !data.ok;

  useEffect(() => {
    if (!isVisible) return;
    const items = notificationItems ?? [];
    for (const n of items) {
      if (CONNECTION_TOAST_MESSAGE_PATTERN.test(n.message)) {
        dispatch(dismissNotification(n.id));
      }
    }
  }, [isVisible, notificationItems, dispatch]);

  useEffect(() => {
    const ok = data?.ok === true;
    if (ok && prevOkRef.current === false) {
      dispatch(dbStatusRestored());
    }
    prevOkRef.current = ok;
  }, [data?.ok, dispatch]);

  if (connectionError || !data || data.ok) {
    return null;
  }

  const settingsHref = projectMatch?.params.projectId
    ? `/projects/${projectMatch.params.projectId}/settings`
    : "/settings";
  const message =
    data.state === "connecting"
      ? "Reconnecting to PostgreSQL..."
      : (data.message ?? "The database is not available; check Settings to fix the connection.");

  return (
    <Banner
      severity="error"
      message={message}
      testId="database-status-banner"
      actions={
        <Link
          to={settingsHref}
          className="text-sm font-semibold underline underline-offset-2 hover:opacity-80"
        >
          Open Settings
        </Link>
      }
    />
  );
}
