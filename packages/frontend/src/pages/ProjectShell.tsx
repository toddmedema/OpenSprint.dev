import { useEffect, useRef } from "react";
import { useParams, useLocation, useNavigate, Outlet, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAppDispatch, useAppSelector } from "../store";
import { resetProject } from "../store/slices/projectSlice";
import { resetWebsocket, clearDeliverToast } from "../store/slices/websocketSlice";
import { resetSketch } from "../store/slices/sketchSlice";
import { resetPlan, clearPlanBackgroundError } from "../store/slices/planSlice";
import { resetExecute } from "../store/slices/executeSlice";
import { resetEval } from "../store/slices/evalSlice";
import { resetDeliver } from "../store/slices/deliverSlice";
import {
  setTasks,
  setExecuteStatusPayload,
} from "../store/slices/executeSlice";
import { setPlansAndGraph, setPlanStatusPayload } from "../store/slices/planSlice";
import { setFeedback } from "../store/slices/evalSlice";
import {
  setPrdContent,
  setPrdHistory,
  setMessages as setSketchMessages,
} from "../store/slices/sketchSlice";
import { setDeliverStatusPayload, setDeliverHistoryPayload } from "../store/slices/deliverSlice";
import { wsConnect, wsDisconnect } from "../store/middleware/websocketMiddleware";
import {
  useProject,
  useTasks,
  usePlans,
  useFeedback,
  useExecuteStatus,
  useDeliverStatus,
  useDeliverHistory,
  usePrd,
  usePrdHistory,
  useSketchChat,
  usePlanStatus,
} from "../api/hooks";
import { queryKeys } from "../api/queryKeys";
import { Layout } from "../components/layout/Layout";
import { getProjectPhasePath } from "../lib/phaseRouting";
import { VALID_PHASE_SLUGS } from "../lib/phaseRouting";
import type { ProjectPhase } from "@opensprint/shared";

/** Derives current view from pathname: "help" | "settings" | phase slug. */
function getViewFromPathname(pathname: string): "help" | "settings" | string {
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (last === "help") return "help";
  if (last === "settings") return "settings";
  return last ?? "sketch";
}

/** Returns true if we're on a phase route (sketch, plan, execute, eval, deliver). */
function isPhaseRoute(view: string): view is ProjectPhase {
  return VALID_PHASE_SLUGS.includes(view as ProjectPhase);
}

/**
 * ProjectShell keeps project state (Redux, WebSocket, TanStack Query sync) alive
 * when navigating between phases, Help, and Settings. Only unmounts when leaving
 * the project entirely, so state is preserved during Help/Settings visits.
 */
export function ProjectShell() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const prevProjectIdRef = useRef<string | null>(null);
  const lastSyncedRef = useRef<Record<string, unknown>>({});

  const view = getViewFromPathname(location.pathname);
  const currentPhase: ProjectPhase = isPhaseRoute(view) ? view : "sketch";
  const isSketch = currentPhase === "sketch";
  const isPlan = currentPhase === "plan";
  const isExecute = currentPhase === "execute";
  const isEval = currentPhase === "eval";
  const isDeliver = currentPhase === "deliver";

  const { data: project, isLoading: projectLoading, error: projectError } = useProject(projectId);
  const { data: tasksData } = useTasks(projectId);
  const { data: plansData } = usePlans(projectId);
  const { data: feedbackData } = useFeedback(projectId);
  const { data: executeStatusData } = useExecuteStatus(projectId, {
    enabled: isExecute,
  });
  const { data: deliverStatusData } = useDeliverStatus(projectId, {
    enabled: isDeliver,
  });
  const { data: deliverHistoryData } = useDeliverHistory(projectId, undefined, {
    enabled: isDeliver,
  });
  const { data: prdData } = usePrd(projectId, {
    enabled: isSketch,
  });
  const { data: prdHistoryData } = usePrdHistory(projectId, {
    enabled: isSketch,
  });
  const { data: sketchChatData } = useSketchChat(projectId, {
    enabled: isSketch,
  });
  const { data: planStatusData } = usePlanStatus(projectId, {
    enabled: isSketch || isPlan,
  });

  // Sync TanStack Query → Redux (keeps state populated even when on Help/Settings)
  useEffect(() => {
    if (!projectId || !tasksData) return;
    if (lastSyncedRef.current["tasks"] === tasksData) return;
    lastSyncedRef.current["tasks"] = tasksData;
    dispatch(setTasks(tasksData));
  }, [projectId, tasksData, dispatch]);
  useEffect(() => {
    if (!projectId || !plansData) return;
    if (lastSyncedRef.current["plans"] === plansData) return;
    lastSyncedRef.current["plans"] = plansData;
    dispatch(setPlansAndGraph({ plans: plansData.plans, dependencyGraph: plansData }));
  }, [projectId, plansData, dispatch]);
  useEffect(() => {
    if (!projectId || feedbackData == null) return;
    if (lastSyncedRef.current["feedback"] === feedbackData) return;
    lastSyncedRef.current["feedback"] = feedbackData;
    dispatch(setFeedback(feedbackData));
  }, [projectId, feedbackData, dispatch]);
  useEffect(() => {
    if (!projectId || !executeStatusData) return;
    if (lastSyncedRef.current["executeStatus"] === executeStatusData) return;
    lastSyncedRef.current["executeStatus"] = executeStatusData;
    dispatch(
      setExecuteStatusPayload({
        activeTasks: executeStatusData.activeTasks ?? [],
        queueDepth: executeStatusData.queueDepth ?? 0,
        awaitingApproval: executeStatusData.awaitingApproval,
        totalDone: executeStatusData.totalDone ?? 0,
        totalFailed: executeStatusData.totalFailed ?? 0,
      })
    );
  }, [projectId, executeStatusData, dispatch]);
  useEffect(() => {
    if (!projectId || !deliverStatusData) return;
    if (lastSyncedRef.current["deliverStatus"] === deliverStatusData) return;
    lastSyncedRef.current["deliverStatus"] = deliverStatusData;
    dispatch(
      setDeliverStatusPayload({
        activeDeployId: deliverStatusData.activeDeployId,
        currentDeploy: deliverStatusData.currentDeploy,
      })
    );
  }, [projectId, deliverStatusData, dispatch]);
  useEffect(() => {
    if (!projectId || deliverHistoryData == null) return;
    if (lastSyncedRef.current["deliverHistory"] === deliverHistoryData) return;
    lastSyncedRef.current["deliverHistory"] = deliverHistoryData;
    dispatch(setDeliverHistoryPayload(deliverHistoryData));
  }, [projectId, deliverHistoryData, dispatch]);
  useEffect(() => {
    if (!projectId || prdData == null) return;
    if (lastSyncedRef.current["prd"] === prdData) return;
    lastSyncedRef.current["prd"] = prdData;
    dispatch(setPrdContent(prdData));
  }, [projectId, prdData, dispatch]);
  useEffect(() => {
    if (!projectId || prdHistoryData == null) return;
    if (lastSyncedRef.current["prdHistory"] === prdHistoryData) return;
    lastSyncedRef.current["prdHistory"] = prdHistoryData;
    dispatch(setPrdHistory(prdHistoryData));
  }, [projectId, prdHistoryData, dispatch]);
  useEffect(() => {
    if (!projectId || sketchChatData == null) return;
    if (lastSyncedRef.current["sketchChat"] === sketchChatData) return;
    lastSyncedRef.current["sketchChat"] = sketchChatData;
    dispatch(setSketchMessages(sketchChatData));
  }, [projectId, sketchChatData, dispatch]);
  useEffect(() => {
    if (!projectId || planStatusData == null) return;
    if (lastSyncedRef.current["planStatus"] === planStatusData) return;
    lastSyncedRef.current["planStatus"] = planStatusData;
    dispatch(setPlanStatusPayload(planStatusData));
  }, [projectId, planStatusData, dispatch]);

  // Project lifecycle: connect WS, reset only when switching projects. Cleanup only on unmount (leave project).
  useEffect(() => {
    if (!projectId) return;

    const switchingProject =
      prevProjectIdRef.current != null && prevProjectIdRef.current !== projectId;
    if (switchingProject) {
      lastSyncedRef.current = {};
      dispatch(resetSketch(undefined as never));
      dispatch(resetPlan(undefined as never));
      dispatch(resetExecute(undefined as never));
      dispatch(resetEval());
      dispatch(resetDeliver());
      dispatch(resetProject());
      dispatch(resetWebsocket());
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.feedback.list(projectId) });
    }
    prevProjectIdRef.current = projectId;
    dispatch(wsConnect({ projectId }));

    return () => {
      dispatch(wsDisconnect());
      dispatch(resetProject());
      dispatch(resetWebsocket());
      dispatch(resetSketch(undefined as never));
      dispatch(resetPlan(undefined as never));
      dispatch(resetExecute(undefined as never));
      dispatch(resetEval());
      dispatch(resetDeliver());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handlePhaseChange = (phase: ProjectPhase) => {
    if (projectId) navigate(getProjectPhasePath(projectId, phase));
  };

  const handleProjectSaved = () => {
    if (projectId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    }
  };

  const deliverToast = useAppSelector((s) => s.websocket.deliverToast);
  const planBackgroundError = useAppSelector((s) => s.plan.backgroundError);
  const connectionError = useAppSelector((s) => s.connection?.connectionError ?? false);

  const handleDismissDeliverToast = () => dispatch(clearDeliverToast());
  const handleDismissPlanBackgroundError = () => dispatch(clearPlanBackgroundError());

  if (!projectId) return null;

  if (projectLoading && !project) {
    return (
      <>
        <Layout>
          <div className="flex items-center justify-center h-full text-theme-muted">
            Loading project...
          </div>
        </Layout>
        <DeliverToast toast={deliverToast} onDismiss={handleDismissDeliverToast} />
        {!connectionError && (
          <PlanRefreshToast
            error={planBackgroundError}
            onDismiss={handleDismissPlanBackgroundError}
          />
        )}
      </>
    );
  }

  if (projectError || (!projectLoading && !project)) {
    return (
      <>
        <Layout>
          <div className="flex flex-col items-center justify-center h-full gap-2 text-theme-muted">
            <p>Project not found or failed to load.</p>
            <Link to="/" className="text-brand-600 hover:text-brand-700 font-medium">
              Return to home
            </Link>
          </div>
        </Layout>
        <DeliverToast toast={deliverToast} onDismiss={handleDismissDeliverToast} />
        {!connectionError && (
          <PlanRefreshToast
            error={planBackgroundError}
            onDismiss={handleDismissPlanBackgroundError}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Layout
        project={project}
        currentPhase={currentPhase}
        onPhaseChange={handlePhaseChange}
        onProjectSaved={handleProjectSaved}
      >
        <Outlet context={{ projectId, project, currentPhase } satisfies ProjectShellContext} />
      </Layout>
      <DeliverToast toast={deliverToast} onDismiss={handleDismissDeliverToast} />
      {!connectionError && (
        <PlanRefreshToast
          error={planBackgroundError}
          onDismiss={handleDismissPlanBackgroundError}
        />
      )}
    </>
  );
}

function PlanRefreshToast({ error, onDismiss }: { error: string | null; onDismiss: () => void }) {
  if (!error) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-40 max-w-md rounded-lg border border-theme-error-border bg-theme-error-bg p-4 shadow-lg text-theme-error-text"
      data-testid="plan-refresh-toast"
      role="alert"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{error}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-theme-muted hover:bg-theme-border-subtle hover:text-theme-text"
          aria-label="Dismiss"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function DeliverToast({
  toast,
  onDismiss,
}: {
  toast: import("../store/slices/websocketSlice").DeliverToast | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;
  const variantStyles: Record<string, string> = {
    started: "border-theme-info-border bg-theme-info-bg text-theme-info-text",
    succeeded: "border-theme-success-border bg-theme-success-bg text-theme-success-text",
    failed: "border-theme-error-border bg-theme-error-bg text-theme-error-text",
  };
  const style =
    variantStyles[toast.variant] ?? "border-theme-border bg-theme-surface text-theme-text";
  return (
    <div
      className={`fixed bottom-4 right-4 z-40 max-w-md rounded-lg border p-4 shadow-lg ${style}`}
      data-testid="deliver-toast"
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{toast.message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-theme-muted hover:bg-theme-border-subtle hover:text-theme-text"
          aria-label="Dismiss"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export interface ProjectShellContext {
  projectId: string;
  project: NonNullable<Awaited<ReturnType<typeof useProject>>["data"]>;
  currentPhase: ProjectPhase;
}
