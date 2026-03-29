import { useEffect, useRef } from "react";
import { Link, useMatch } from "react-router-dom";
import { useDbStatus } from "../api/hooks";
import { useAppSelector, useAppDispatch } from "../store";
import { CONNECTION_TOAST_MESSAGE_PATTERN } from "../lib/connectionNotificationConstants";
import { dbStatusRestored } from "../store/slices/connectionSlice";
import { dismissNotification } from "../store/slices/notificationSlice";
import { Banner } from "./notifications";

const STARTUP_FAILURE_PREFIX = "Connected to database, but Open Sprint could not finish startup:";

function toBannerMessage(data: { state: string; message?: string }): string {
  if (data.state === "connecting") {
    return "Reconnecting to PostgreSQL...";
  }
  const raw = data.message?.trim();
  if (!raw) {
    return "The database is not available; check Settings to fix the connection.";
  }
  if (raw.startsWith(STARTUP_FAILURE_PREFIX)) {
    const detail = raw.slice(STARTUP_FAILURE_PREFIX.length).trim();
    return detail
      ? `Connected to database, but Open Sprint could not finish startup. ${detail}`
      : "Connected to database, but Open Sprint could not finish startup. Check backend logs for details.";
  }
  return raw;
}

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
  const message = toBannerMessage(data);

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
