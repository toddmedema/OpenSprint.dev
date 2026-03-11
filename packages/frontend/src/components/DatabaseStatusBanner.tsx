import { useEffect, useRef } from "react";
import { Link, useMatch } from "react-router-dom";
import { useDbStatus } from "../api/hooks";
import { useAppSelector, useAppDispatch } from "../store";
import { dbStatusRestored } from "../store/slices/connectionSlice";

export function DatabaseStatusBanner() {
  const dispatch = useAppDispatch();
  const connectionError = useAppSelector((s) => s.connection?.connectionError ?? false);
  const { data } = useDbStatus();
  const projectMatch = useMatch("/projects/:projectId/*");
  const prevOkRef = useRef<boolean | null>(null);

  // When db-status health check returns ok, signal so connection/Postgres toasts auto-dismiss.
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
      : data.message ??
        "The database is not available; check Settings to fix the connection.";

  return (
    <div
      className="flex items-center justify-center gap-3 border-b border-theme-error-border bg-theme-error-bg px-4 py-3 text-theme-error-text shrink-0"
      data-testid="database-status-banner"
      role="alert"
    >
      <p className="text-sm font-medium">{message}</p>
      <Link
        to={settingsHref}
        className="text-sm font-semibold underline underline-offset-2 hover:opacity-80"
      >
        Open Settings
      </Link>
    </div>
  );
}
