import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isApiError } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";

interface TodoistIntegrationCardProps {
  projectId: string;
}

const OAUTH_POLL_INTERVAL_MS = 2_000;
const OAUTH_POLL_MAX_ATTEMPTS = 150; // 5 minutes

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const INTAKE_STATUS_BADGE = {
  active: { label: "Connected", className: "text-green-400 bg-green-500/10" },
  needs_reconnect: { label: "Needs Reconnect", className: "text-orange-400 bg-orange-500/10" },
  disconnected: { label: "Not Connected", className: "text-theme-text-secondary bg-theme-surface-hover" },
  loading: { label: "Loading…", className: "text-theme-text-secondary bg-theme-surface-hover" },
} as const;

const intakePrimaryBtn =
  "px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const intakeSecondaryBtn =
  "px-2 py-1 bg-theme-surface-hover hover:bg-theme-border text-theme-text text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const intakeDangerBtn =
  "px-2 py-1 text-xs font-medium rounded border border-theme-error-border text-theme-error-text hover:bg-theme-error-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

function IntakeTodoistShell({
  description,
  badge,
  children,
  footer,
}: {
  description: string;
  badge: { label: string; className: string };
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="rounded-lg border border-theme-border bg-theme-surface p-4 flex flex-col gap-3 h-full"
      data-testid="todoist-integration-card"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <TodoistIcon />
          <div className="min-w-0">
            <p className="text-sm font-medium text-theme-text">Todoist</p>
            <p className="text-xs text-theme-text-secondary">{description}</p>
          </div>
        </div>
        <span
          className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-medium ${badge.className}`}
          data-testid="todoist-status-badge"
        >
          {badge.label}
        </span>
      </div>
      {children}
      {footer != null ? (
        <div className="flex flex-wrap items-center gap-2 mt-auto pt-2 border-t border-theme-border">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function TodoistIntegrationCard({ projectId }: TodoistIntegrationCardProps) {
  const queryClient = useQueryClient();
  const [oauthPolling, setOauthPolling] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedPickerProjectId, setSelectedPickerProjectId] = useState<string>("");
  const [importExistingTasks, setImportExistingTasks] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ text: string; severity: "success" | "error" | "warning" } | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [, setTick] = useState(0);
  const pollCountRef = useRef(0);
  const oauthWindowRef = useRef<Window | null>(null);

  const statusQuery = useQuery({
    queryKey: queryKeys.integrations.todoistStatus(projectId),
    queryFn: () => api.integrations.todoist.getStatus(projectId),
    retry: false,
  });

  const notConfigured =
    (statusQuery.isError &&
      isApiError(statusQuery.error) &&
      (statusQuery.error.code === "INTEGRATION_NOT_CONFIGURED" ||
        statusQuery.error.message?.includes("not configured"))) ||
    (statusQuery.data && !statusQuery.data.connected && statusQuery.data.notConfigured === true);

  const startOAuthMutation = useMutation({
    mutationFn: () => api.integrations.todoist.startOAuth(projectId),
    onSuccess: (data) => {
      const popup = window.open(
        data.authorizationUrl,
        "todoist-oauth",
        "width=600,height=700,popup=yes"
      );
      oauthWindowRef.current = popup;
      pollCountRef.current = 0;
      setOauthPolling(true);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.integrations.todoist.disconnect(projectId),
    onSuccess: () => {
      setShowDisconnectConfirm(false);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.todoistStatus(projectId),
      });
    },
  });

  const shouldShowPicker =
    pickerOpen || (!!statusQuery.data?.connected && !statusQuery.data?.selectedProject);

  const projectsQuery = useQuery({
    queryKey: queryKeys.integrations.todoistProjects(projectId),
    queryFn: () => api.integrations.todoist.listProjects(projectId),
    enabled: shouldShowPicker,
    retry: 1,
    staleTime: 30_000,
  });

  const selectProjectMutation = useMutation({
    mutationFn: (args: { todoistProjectId: string; importExistingOpenTasks: boolean }) =>
      api.integrations.todoist.selectProject(projectId, {
        todoistProjectId: args.todoistProjectId,
        ...(args.importExistingOpenTasks ? { importExistingOpenTasks: true } : {}),
      }),
    onSuccess: () => {
      setSaveSuccess(true);
      setPickerOpen(false);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.todoistStatus(projectId),
      });
      setTimeout(() => setSaveSuccess(false), 3_000);
    },
  });

  const syncNowMutation = useMutation({
    mutationFn: () => api.integrations.todoist.syncNow(projectId),
    onSuccess: (data) => {
      setSyncMessage({ text: `${data.imported} item${data.imported === 1 ? "" : "s"} imported`, severity: "success" });
      setTimeout(() => setSyncMessage(null), 5_000);
    },
    onError: (error) => {
      if (isApiError(error) && (error.code === "RATE_LIMITED" || error.code === "SYNC_RATE_LIMITED")) {
        setSyncMessage({ text: "Please wait before syncing again", severity: "warning" });
      } else {
        setSyncMessage({ text: error instanceof Error ? error.message : "Sync failed", severity: "error" });
      }
      setTimeout(() => setSyncMessage(null), 5_000);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.todoistStatus(projectId),
      });
    },
  });

  const refreshStatus = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.integrations.todoistStatus(projectId),
    });
  }, [queryClient, projectId]);

  useEffect(() => {
    if (pickerOpen && !selectedPickerProjectId && statusQuery.data?.selectedProject?.id) {
      setSelectedPickerProjectId(statusQuery.data.selectedProject.id);
    }
  }, [pickerOpen, selectedPickerProjectId, statusQuery.data?.selectedProject?.id]);

  useEffect(() => {
    if (shouldShowPicker && statusQuery.data?.pendingOneTimeImport) {
      setImportExistingTasks(true);
    }
  }, [shouldShowPicker, statusQuery.data?.pendingOneTimeImport]);

  // Periodically re-render to keep relative time fresh
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Reset error dismissed state when lastError changes
  const lastError = statusQuery.data?.lastError;
  useEffect(() => {
    setErrorDismissed(false);
  }, [lastError]);

  useEffect(() => {
    if (!oauthPolling) return;

    const interval = setInterval(() => {
      pollCountRef.current += 1;

      const popupClosed = oauthWindowRef.current && oauthWindowRef.current.closed;
      if (popupClosed || pollCountRef.current >= OAUTH_POLL_MAX_ATTEMPTS) {
        setOauthPolling(false);
        refreshStatus();
        return;
      }

      void queryClient
        .fetchQuery({
          queryKey: queryKeys.integrations.todoistStatus(projectId),
          queryFn: () => api.integrations.todoist.getStatus(projectId),
          staleTime: 0,
        })
        .then((data) => {
          if (data?.connected) {
            setOauthPolling(false);
            if (oauthWindowRef.current && !oauthWindowRef.current.closed) {
              oauthWindowRef.current.close();
            }
            refreshStatus();
          }
        })
        .catch(() => {});
    }, OAUTH_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [oauthPolling, projectId, queryClient, refreshStatus]);

  // Not configured — no credentials in Settings or env
  if (notConfigured) {
    return (
      <IntakeTodoistShell
        description="Import feedback from Todoist tasks into Evaluate"
        badge={INTAKE_STATUS_BADGE.disconnected}
      >
        <div
          className="p-3 rounded-lg bg-theme-warning-bg border border-theme-warning-border"
          data-testid="todoist-not-configured"
        >
          <p className="text-xs text-theme-warning-text">
            Todoist integration requires OAuth app credentials. Open{" "}
            <strong>Settings &rarr; Todoist Credentials</strong> to enter your Client ID, Client
            Secret, and Redirect URI.
          </p>
        </div>
      </IntakeTodoistShell>
    );
  }

  // Loading state
  if (statusQuery.isLoading) {
    return (
      <IntakeTodoistShell
        description="Loading integration status…"
        badge={INTAKE_STATUS_BADGE.loading}
      />
    );
  }

  // Error state (non-configuration)
  if (statusQuery.isError && !notConfigured) {
    return (
      <IntakeTodoistShell
        description="Import feedback from Todoist tasks into Evaluate"
        badge={INTAKE_STATUS_BADGE.disconnected}
        footer={
          <button type="button" className={intakeSecondaryBtn} onClick={refreshStatus}>
            Retry
          </button>
        }
      >
        <div className="p-3 rounded-lg bg-theme-error-bg border border-theme-error-border">
          <p className="text-xs text-theme-error-text">
            Failed to load Todoist status. Please try again.
          </p>
        </div>
      </IntakeTodoistShell>
    );
  }

  const status = statusQuery.data;

  // Disconnected state
  if (!status?.connected) {
    return (
      <IntakeTodoistShell
        description="Import feedback from Todoist tasks into Evaluate"
        badge={INTAKE_STATUS_BADGE.disconnected}
        footer={
          <button
            type="button"
            className={intakePrimaryBtn}
            onClick={() => startOAuthMutation.mutate()}
            disabled={startOAuthMutation.isPending || oauthPolling}
            data-testid="todoist-connect-btn"
          >
            {oauthPolling
              ? "Waiting for authorization…"
              : startOAuthMutation.isPending
                ? "Starting…"
                : "Connect Todoist"}
          </button>
        }
      >
        {startOAuthMutation.isError && (
          <p className="text-xs text-theme-error-text">
            {isApiError(startOAuthMutation.error)
              ? startOAuthMutation.error.message
              : "Failed to start OAuth. Please try again."}
          </p>
        )}
      </IntakeTodoistShell>
    );
  }

  // Connected state
  const needsReconnect = status.status === "needs_reconnect";
  const email = status.todoistUser?.email ?? status.todoistUser?.id ?? "Unknown";
  const selectedProject = status.selectedProject;

  return (
    <IntakeTodoistShell
      description="Import feedback from Todoist tasks into Evaluate"
      badge={needsReconnect ? INTAKE_STATUS_BADGE.needs_reconnect : INTAKE_STATUS_BADGE.active}
      footer={
        <>
          {selectedProject ? (
            <button
              type="button"
              className={`${intakeSecondaryBtn} inline-flex items-center gap-1.5`}
              onClick={() => syncNowMutation.mutate()}
              disabled={syncNowMutation.isPending}
              data-testid="todoist-sync-now-btn"
            >
              {syncNowMutation.isPending && (
                <span
                  className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
                  data-testid="todoist-sync-spinner"
                />
              )}
              {syncNowMutation.isPending ? "Syncing…" : "Sync Now"}
            </button>
          ) : null}
          {!showDisconnectConfirm ? (
            <button
              type="button"
              className={`${intakeDangerBtn} ${selectedProject ? "ml-auto" : ""}`}
              onClick={() => setShowDisconnectConfirm(true)}
              data-testid="todoist-disconnect-btn"
            >
              Disconnect
            </button>
          ) : null}
          {showDisconnectConfirm ? (
            <div
              className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-theme-error-bg border border-theme-error-border w-full"
              data-testid="todoist-disconnect-confirm"
            >
              <p className="text-xs text-theme-error-text flex-1 min-w-[12rem]">
                This will revoke the Todoist token permanently. Continue?
              </p>
              <button
                type="button"
                className="text-xs font-medium text-theme-error-text hover:underline"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                data-testid="todoist-disconnect-confirm-btn"
              >
                {disconnectMutation.isPending ? "Disconnecting…" : "Yes, disconnect"}
              </button>
              <button
                type="button"
                className="text-xs text-theme-muted hover:underline"
                onClick={() => setShowDisconnectConfirm(false)}
                data-testid="todoist-disconnect-cancel-btn"
              >
                Cancel
              </button>
            </div>
          ) : null}
        </>
      }
    >
      <p className="text-xs text-theme-muted" data-testid="todoist-status-line">
        Connected to {email}
        {selectedProject && <> · Project: {selectedProject.name}</>}
        {status.lastSyncAt && <> · Last sync: {relativeTime(status.lastSyncAt)}</>}
      </p>

      {needsReconnect && (
        <div
          className="p-3 rounded-lg bg-theme-warning-bg border border-theme-warning-border"
          data-testid="todoist-reconnect-banner"
        >
          {status.lastError ? (
            <p className="text-xs text-theme-warning-text font-medium mb-2" data-testid="todoist-reconnect-error">
              {status.lastError}
            </p>
          ) : null}
          <p className="text-xs text-theme-warning-text">
            Your Todoist connection needs to be re-authorized. Reconnect to restore access and continue
            syncing.
          </p>
          <button
            type="button"
            className={`${intakeSecondaryBtn} mt-2`}
            onClick={() => startOAuthMutation.mutate()}
            disabled={startOAuthMutation.isPending || oauthPolling}
            data-testid="todoist-reconnect-btn"
          >
            {oauthPolling ? "Waiting for authorization…" : "Reconnect"}
          </button>
        </div>
      )}

      {status.lastError && !needsReconnect && !errorDismissed && (
        <div
          className="p-3 rounded-lg bg-theme-error-bg border border-theme-error-border"
          data-testid="todoist-error-banner"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-theme-error-text">{status.lastError}</p>
              <p className="text-xs text-theme-error-text mt-1 opacity-75">
                Check your Todoist connection or try syncing again.
              </p>
            </div>
            <button
              type="button"
              className="text-theme-error-text hover:opacity-70 flex-shrink-0"
              onClick={() => setErrorDismissed(true)}
              aria-label="Dismiss error"
              data-testid="todoist-error-dismiss-btn"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {shouldShowPicker ? (
        <ProjectPicker
          pickerOpen={shouldShowPicker}
          projectsQuery={projectsQuery}
          selectedPickerProjectId={selectedPickerProjectId}
          importExistingTasks={importExistingTasks}
          selectProjectMutation={selectProjectMutation}
          selectedProject={selectedProject ?? null}
          onOpen={() => setPickerOpen(true)}
          onCancel={() => {
            setPickerOpen(false);
            setSelectedPickerProjectId(selectedProject?.id ?? "");
          }}
          onSelectChange={setSelectedPickerProjectId}
          onImportToggle={setImportExistingTasks}
          onRetryFetch={() => void projectsQuery.refetch()}
          secondaryButtonClass={intakeSecondaryBtn}
          primaryButtonClass={intakePrimaryBtn}
          showPermanentDeletionNotice
        />
      ) : selectedProject ? (
        <div data-testid="todoist-project-info">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-theme-muted">
              Project: <span className="font-medium text-theme-text">{selectedProject.name}</span>
              <span className="ml-1 text-theme-muted">({selectedProject.id})</span>
            </span>
            <button
              type="button"
              className="text-xs text-blue-600 hover:underline dark:text-blue-400"
              onClick={() => {
                setPickerOpen(true);
                setSelectedPickerProjectId(selectedProject.id);
              }}
              data-testid="todoist-change-project-btn"
            >
              Change
            </button>
          </div>
          {saveSuccess && (
            <p
              className="text-xs text-green-600 dark:text-green-400 mt-1"
              data-testid="todoist-save-success"
            >
              Project saved successfully.
            </p>
          )}
        </div>
      ) : null}

      {selectedProject ? (
        <div data-testid="todoist-sync-section">
          {syncMessage && (
            <p
              className={`text-xs ${
                syncMessage.severity === "success"
                  ? "text-green-600 dark:text-green-400"
                  : syncMessage.severity === "warning"
                    ? "text-theme-warning-text"
                    : "text-theme-error-text"
              }`}
              data-testid="todoist-sync-message"
            >
              {syncMessage.text}
            </p>
          )}
          <p className="text-xs text-theme-muted mt-2" data-testid="todoist-delete-warning">
            Tasks will be permanently deleted from Todoist after successful import.
          </p>
        </div>
      ) : null}

      {disconnectMutation.isSuccess &&
        disconnectMutation.data?.pendingDeletesWarning != null &&
        disconnectMutation.data.pendingDeletesWarning > 0 && (
          <div
            className="p-2 rounded-lg bg-theme-warning-bg border border-theme-warning-border"
            data-testid="todoist-pending-deletes-warning"
          >
            <p className="text-xs text-theme-warning-text">
              {disconnectMutation.data.pendingDeletesWarning} imported task(s) had pending deletions
              in Todoist that could not be completed.
            </p>
          </div>
        )}
    </IntakeTodoistShell>
  );
}

interface ProjectPickerProps {
  pickerOpen: boolean;
  /** When set, shows Todoist deletion helper next to the project picker. */
  showPermanentDeletionNotice?: boolean;
  projectsQuery: {
    data?: { projects: Array<{ id: string; name: string; taskCount?: number }> };
    isLoading: boolean;
    isFetching: boolean;
    isError: boolean;
    refetch: () => unknown;
  };
  selectedPickerProjectId: string;
  importExistingTasks: boolean;
  selectProjectMutation: {
    isPending: boolean;
    isError: boolean;
    mutate: (args: { todoistProjectId: string; importExistingOpenTasks: boolean }) => void;
  };
  selectedProject: { id: string; name: string } | null;
  onOpen: () => void;
  onCancel: () => void;
  onSelectChange: (value: string) => void;
  onImportToggle: (value: boolean) => void;
  onRetryFetch: () => void;
  secondaryButtonClass?: string;
  primaryButtonClass?: string;
}

function ProjectPicker({
  pickerOpen,
  showPermanentDeletionNotice = false,
  projectsQuery,
  selectedPickerProjectId,
  importExistingTasks,
  selectProjectMutation,
  selectedProject,
  onOpen,
  onCancel,
  onSelectChange,
  onImportToggle,
  onRetryFetch,
  secondaryButtonClass = "btn-secondary text-sm",
  primaryButtonClass = "btn-primary text-sm",
}: ProjectPickerProps) {
  const projects = projectsQuery.data?.projects ?? [];
  const isLoading = projectsQuery.isLoading || projectsQuery.isFetching;
  const isError = projectsQuery.isError;
  const hasProjects = projects.length > 0;

  if (!pickerOpen) {
    return (
      <div>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={onOpen}
          data-testid="todoist-open-picker-btn"
        >
          Select a Todoist project
        </button>
      </div>
    );
  }

  return (
    <div data-testid="todoist-project-picker">
      <label
        htmlFor="todoist-project-select"
        className="block text-xs font-medium text-theme-text mb-1"
      >
        {selectedProject ? "Change Todoist project" : "Select a Todoist project"}
      </label>

      {showPermanentDeletionNotice ? (
        <p className="text-xs text-theme-muted mb-2" data-testid="todoist-picker-delete-notice">
          Tasks will be permanently deleted from Todoist after successful import.
        </p>
      ) : null}

      {isLoading && !hasProjects && (
        <div className="flex items-center gap-2 py-2" data-testid="todoist-projects-loading">
          <div className="w-4 h-4 border-2 border-theme-border border-t-blue-500 rounded-full animate-spin" />
          <span className="text-xs text-theme-muted">Loading projects…</span>
        </div>
      )}

      {isError && !hasProjects && (
        <div
          className="p-3 rounded-lg bg-theme-error-bg border border-theme-error-border"
          data-testid="todoist-projects-error"
        >
          <p className="text-xs text-theme-error-text">Failed to load Todoist projects.</p>
          <button
            type="button"
            className="text-xs text-theme-error-text font-medium hover:underline mt-1"
            onClick={onRetryFetch}
            data-testid="todoist-projects-retry-btn"
          >
            Retry
          </button>
        </div>
      )}

      {(hasProjects || (!isLoading && !isError)) && (
        <>
          <select
            id="todoist-project-select"
            className="w-full text-sm rounded border border-theme-border bg-theme-bg px-2 py-1.5 text-theme-text"
            value={selectedPickerProjectId}
            onChange={(e) => onSelectChange(e.target.value)}
            disabled={selectProjectMutation.isPending}
            data-testid="todoist-project-select"
          >
            <option value="">Select a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.taskCount != null ? ` (${p.taskCount} tasks)` : ""}
              </option>
            ))}
          </select>

          <div className="mt-2">
            <label
              className="flex items-center gap-2 cursor-pointer"
              data-testid="todoist-import-toggle"
            >
              <input
                type="checkbox"
                checked={importExistingTasks}
                onChange={(e) => onImportToggle(e.target.checked)}
                disabled={selectProjectMutation.isPending}
                className="rounded border-theme-border"
                data-testid="todoist-import-checkbox"
              />
              <span className="text-xs text-theme-text">Import existing open tasks (one-time)</span>
            </label>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={!selectedPickerProjectId || selectProjectMutation.isPending}
              onClick={() =>
                selectProjectMutation.mutate({
                  todoistProjectId: selectedPickerProjectId,
                  importExistingOpenTasks: importExistingTasks,
                })
              }
              data-testid="todoist-save-project-btn"
            >
              {selectProjectMutation.isPending ? "Saving…" : "Save"}
            </button>
            {selectedProject && (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={onCancel}
                disabled={selectProjectMutation.isPending}
                data-testid="todoist-cancel-picker-btn"
              >
                Cancel
              </button>
            )}
          </div>

          {selectProjectMutation.isError && (
            <p className="text-xs text-theme-error-text mt-2" data-testid="todoist-save-error">
              Failed to save project selection. Please try again.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function TodoistIcon() {
  return (
    <div
      className="w-7 h-7 rounded-md bg-[#E44332] flex items-center justify-center flex-shrink-0"
      aria-hidden="true"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M2 4.5L6.5 7L11 4.5M2 8L6.5 10.5L11 8M2 11.5L6.5 14L11 11.5"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
