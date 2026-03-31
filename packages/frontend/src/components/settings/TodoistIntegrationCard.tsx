import { useState, useCallback, useRef, useEffect } from "react";
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

export function TodoistIntegrationCard({ projectId }: TodoistIntegrationCardProps) {
  const queryClient = useQueryClient();
  const [oauthPolling, setOauthPolling] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedPickerProjectId, setSelectedPickerProjectId] = useState<string>("");
  const [importExistingTasks, setImportExistingTasks] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const pollCountRef = useRef(0);
  const oauthWindowRef = useRef<Window | null>(null);

  const statusQuery = useQuery({
    queryKey: queryKeys.integrations.todoistStatus(projectId),
    queryFn: () => api.integrations.todoist.getStatus(projectId),
    retry: false,
  });

  const notConfigured =
    statusQuery.isError &&
    isApiError(statusQuery.error) &&
    (statusQuery.error.code === "INTEGRATION_NOT_CONFIGURED" ||
      statusQuery.error.message?.includes("not configured"));

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

  const shouldShowPicker = pickerOpen || (!!statusQuery.data?.connected && !statusQuery.data?.selectedProject);

  const projectsQuery = useQuery({
    queryKey: queryKeys.integrations.todoistProjects(projectId),
    queryFn: () => api.integrations.todoist.listProjects(projectId),
    enabled: shouldShowPicker,
    retry: 1,
    staleTime: 30_000,
  });

  const selectProjectMutation = useMutation({
    mutationFn: (todoistProjectId: string) =>
      api.integrations.todoist.selectProject(projectId, { todoistProjectId }),
    onSuccess: () => {
      setSaveSuccess(true);
      setPickerOpen(false);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.todoistStatus(projectId),
      });
      setTimeout(() => setSaveSuccess(false), 3_000);
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

  // Not configured — env vars missing
  if (notConfigured) {
    return (
      <div
        className="rounded-lg border border-theme-border bg-theme-bg-elevated p-4"
        data-testid="todoist-integration-card"
      >
        <div className="flex items-start gap-3">
          <TodoistIcon />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-theme-text">Todoist</h3>
            <p className="text-xs text-theme-muted mt-0.5">
              Import feedback from Todoist tasks into Evaluate
            </p>
            <div
              className="mt-3 p-3 rounded-lg bg-theme-warning-bg border border-theme-warning-border"
              data-testid="todoist-not-configured"
            >
              <p className="text-xs text-theme-warning-text">
                Todoist integration requires <code className="font-mono">TODOIST_CLIENT_ID</code>{" "}
                and <code className="font-mono">TODOIST_CLIENT_SECRET</code> environment variables.
                Set them in your <code className="font-mono">.env</code> file and restart the
                server.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (statusQuery.isLoading) {
    return (
      <div
        className="rounded-lg border border-theme-border bg-theme-bg-elevated p-4"
        data-testid="todoist-integration-card"
      >
        <div className="flex items-center gap-3">
          <TodoistIcon />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-theme-text">Todoist</h3>
            <p className="text-xs text-theme-muted mt-0.5">Loading integration status…</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state (non-configuration)
  if (statusQuery.isError && !notConfigured) {
    return (
      <div
        className="rounded-lg border border-theme-border bg-theme-bg-elevated p-4"
        data-testid="todoist-integration-card"
      >
        <div className="flex items-start gap-3">
          <TodoistIcon />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-theme-text">Todoist</h3>
            <p className="text-xs text-theme-muted mt-0.5">
              Import feedback from Todoist tasks into Evaluate
            </p>
            <div className="mt-3 p-3 rounded-lg bg-theme-error-bg border border-theme-error-border">
              <p className="text-xs text-theme-error-text">
                Failed to load Todoist status. Please try again.
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary text-sm mt-3"
              onClick={refreshStatus}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const status = statusQuery.data;

  // Disconnected state
  if (!status?.connected) {
    return (
      <div
        className="rounded-lg border border-theme-border bg-theme-bg-elevated p-4"
        data-testid="todoist-integration-card"
      >
        <div className="flex items-start gap-3">
          <TodoistIcon />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-theme-text">Todoist</h3>
            <p className="text-xs text-theme-muted mt-0.5">
              Import feedback from Todoist tasks into Evaluate
            </p>
            <button
              type="button"
              className="btn-secondary text-sm mt-3"
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
            {startOAuthMutation.isError && (
              <p className="text-xs text-theme-error-text mt-2">
                Failed to start OAuth. Please try again.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Connected state
  const needsReconnect = status.status === "needs_reconnect";
  const email = status.todoistUser?.email ?? status.todoistUser?.id ?? "Unknown";
  const selectedProject = status.selectedProject;

  return (
    <div
      className="rounded-lg border border-theme-border bg-theme-bg-elevated p-4"
      data-testid="todoist-integration-card"
    >
      <div className="flex items-start gap-3">
        <TodoistIcon />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-theme-text">Todoist</h3>
            <span
              className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${
                needsReconnect
                  ? "bg-theme-warning-bg text-theme-warning-text"
                  : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              }`}
              data-testid="todoist-status-badge"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${needsReconnect ? "bg-yellow-500" : "bg-green-500"}`}
              />
              {needsReconnect ? "Needs reconnect" : "Connected"}
            </span>
          </div>

          {/* Status line */}
          <p className="text-xs text-theme-muted mt-1" data-testid="todoist-status-line">
            Connected to {email}
            {selectedProject && <> · Project: {selectedProject.name}</>}
            {status.lastSyncAt && <> · Last sync: {relativeTime(status.lastSyncAt)}</>}
          </p>

          {/* Needs reconnect banner */}
          {needsReconnect && (
            <div
              className="mt-3 p-3 rounded-lg bg-theme-warning-bg border border-theme-warning-border"
              data-testid="todoist-reconnect-banner"
            >
              <p className="text-xs text-theme-warning-text">
                Your Todoist connection needs to be re-authorized. Please reconnect to continue
                syncing.
              </p>
              <button
                type="button"
                className="btn-secondary text-xs mt-2"
                onClick={() => startOAuthMutation.mutate()}
                disabled={startOAuthMutation.isPending || oauthPolling}
                data-testid="todoist-reconnect-btn"
              >
                {oauthPolling ? "Waiting for authorization…" : "Reconnect"}
              </button>
            </div>
          )}

          {/* Error banner (non-reconnect) */}
          {status.lastError && !needsReconnect && (
            <div
              className="mt-3 p-3 rounded-lg bg-theme-error-bg border border-theme-error-border"
              data-testid="todoist-error-banner"
            >
              <p className="text-xs text-theme-error-text">{status.lastError}</p>
            </div>
          )}

          {/* Project picker */}
          {shouldShowPicker ? (
            <ProjectPicker
              pickerOpen={shouldShowPicker}
              projectsQuery={projectsQuery}
              selectedPickerProjectId={selectedPickerProjectId}
              importExistingTasks={importExistingTasks}
              selectProjectMutation={selectProjectMutation}
              selectedProject={selectedProject ?? null}
              onOpen={() => setPickerOpen(true)}
              onCancel={() => { setPickerOpen(false); setSelectedPickerProjectId(selectedProject?.id ?? ""); }}
              onSelectChange={setSelectedPickerProjectId}
              onImportToggle={setImportExistingTasks}
              onRetryFetch={() => void projectsQuery.refetch()}
            />
          ) : selectedProject ? (
            <div className="mt-3" data-testid="todoist-project-info">
              <div className="flex items-center gap-2">
                <span className="text-xs text-theme-muted">
                  Project: <span className="font-medium text-theme-text">{selectedProject.name}</span>
                  <span className="ml-1 text-theme-muted">({selectedProject.id})</span>
                </span>
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() => { setPickerOpen(true); setSelectedPickerProjectId(selectedProject.id); }}
                  data-testid="todoist-change-project-btn"
                >
                  Change
                </button>
              </div>
              {saveSuccess && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-1" data-testid="todoist-save-success">
                  Project saved successfully.
                </p>
              )}
            </div>
          ) : null}

          {/* Disconnect */}
          <div className="mt-3 flex items-center gap-2">
            {!showDisconnectConfirm ? (
              <button
                type="button"
                className="text-xs text-theme-error-text hover:underline"
                onClick={() => setShowDisconnectConfirm(true)}
                data-testid="todoist-disconnect-btn"
              >
                Disconnect
              </button>
            ) : (
              <div
                className="flex items-center gap-2 p-2 rounded-lg bg-theme-error-bg border border-theme-error-border"
                data-testid="todoist-disconnect-confirm"
              >
                <p className="text-xs text-theme-error-text">
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
            )}
          </div>

          {/* Pending deletes warning from disconnect */}
          {disconnectMutation.isSuccess &&
            disconnectMutation.data?.pendingDeletesWarning != null &&
            disconnectMutation.data.pendingDeletesWarning > 0 && (
              <div
                className="mt-2 p-2 rounded-lg bg-theme-warning-bg border border-theme-warning-border"
                data-testid="todoist-pending-deletes-warning"
              >
                <p className="text-xs text-theme-warning-text">
                  {disconnectMutation.data.pendingDeletesWarning} imported task(s) had pending
                  deletions in Todoist that could not be completed.
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

interface ProjectPickerProps {
  pickerOpen: boolean;
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
    mutate: (projectId: string) => void;
  };
  selectedProject: { id: string; name: string } | null;
  onOpen: () => void;
  onCancel: () => void;
  onSelectChange: (value: string) => void;
  onImportToggle: (value: boolean) => void;
  onRetryFetch: () => void;
}

function ProjectPicker({
  pickerOpen,
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
}: ProjectPickerProps) {
  const projects = projectsQuery.data?.projects ?? [];
  const isLoading = projectsQuery.isLoading || projectsQuery.isFetching;
  const isError = projectsQuery.isError;
  const hasProjects = projects.length > 0;

  if (!pickerOpen) {
    return (
      <div className="mt-3">
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={onOpen}
          data-testid="todoist-open-picker-btn"
        >
          Select a Todoist project
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3" data-testid="todoist-project-picker">
      <label htmlFor="todoist-project-select" className="block text-xs font-medium text-theme-text mb-1">
        {selectedProject ? "Change Todoist project" : "Select a Todoist project"}
      </label>

      {isLoading && !hasProjects && (
        <div className="flex items-center gap-2 py-2" data-testid="todoist-projects-loading">
          <div className="w-4 h-4 border-2 border-theme-border border-t-blue-500 rounded-full animate-spin" />
          <span className="text-xs text-theme-muted">Loading projects…</span>
        </div>
      )}

      {isError && !hasProjects && (
        <div className="p-3 rounded-lg bg-theme-error-bg border border-theme-error-border" data-testid="todoist-projects-error">
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
                {p.name}{p.taskCount != null ? ` (${p.taskCount} tasks)` : ""}
              </option>
            ))}
          </select>

          <div className="mt-2">
            <label className="flex items-center gap-2 cursor-pointer" data-testid="todoist-import-toggle">
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
              className="btn-primary text-sm"
              disabled={!selectedPickerProjectId || selectProjectMutation.isPending}
              onClick={() => selectProjectMutation.mutate(selectedPickerProjectId)}
              data-testid="todoist-save-project-btn"
            >
              {selectProjectMutation.isPending ? "Saving…" : "Save"}
            </button>
            {selectedProject && (
              <button
                type="button"
                className="btn-secondary text-sm"
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
      className="w-8 h-8 rounded-md bg-[#E44332] flex items-center justify-center flex-shrink-0"
      aria-hidden="true"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
