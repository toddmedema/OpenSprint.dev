import { lazy, Suspense, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation, Navigate } from "react-router-dom";
import type { ProjectPhase } from "@opensprint/shared";
import {
  phaseFromSlug,
  getProjectPhasePath,
  isValidPhaseSlug,
  parseDetailParams,
} from "../lib/phaseRouting";
import { PhaseLoadingFallback } from "../components/PhaseLoadingFallback";
import { useAppSelector } from "../store";

const LazySketchPhase = lazy(() =>
  import("./phases/SketchPhase").then((m) => ({ default: m.SketchPhase }))
);
const LazyPlanPhase = lazy(() =>
  import("./phases/PlanPhase").then((m) => ({ default: m.PlanPhase }))
);
const LazyExecutePhase = lazy(() =>
  import("./phases/ExecutePhase").then((m) => ({ default: m.ExecutePhase }))
);
const LazyEvalPhase = lazy(() =>
  import("./phases/EvalPhase").then((m) => ({ default: m.EvalPhase }))
);
const LazyDeliverPhase = lazy(() =>
  import("./phases/DeliverPhase").then((m) => ({ default: m.DeliverPhase }))
);

/**
 * Phase content (Sketch, Plan, Execute, Evaluate, Deliver). Renders inside ProjectShell.
 * Project state is managed by ProjectShell and persists when navigating to Help/Settings.
 */
export function ProjectView() {
  const { projectId, phase: phaseSlug } = useParams<{ projectId: string; phase?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo =
    projectId && !isValidPhaseSlug(phaseSlug) ? getProjectPhasePath(projectId, "sketch") : null;

  const currentPhase = phaseFromSlug(phaseSlug);
  const detailParams = parseDetailParams(location.search);
  const selectedPlanIdFromStore = useAppSelector((state) => state.plan.selectedPlanId);
  const selectedTaskIdFromStore = useAppSelector((state) => state.execute.selectedTaskId);
  const previousPhaseRef = useRef<ProjectPhase | null>(null);
  const enteringExecutePhase =
    currentPhase === "execute" && previousPhaseRef.current !== "execute";
  const selectedPlanId = detailParams.plan ?? selectedPlanIdFromStore ?? null;
  const selectedTaskId =
    detailParams.task ??
    (currentPhase !== "execute" || enteringExecutePhase ? (selectedTaskIdFromStore ?? null) : null);
  const selectedFeedbackId = currentPhase === "eval" ? detailParams.feedback : null;

  useEffect(() => {
    if (!projectId || redirectTo) return;
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = currentPhase;

    if (currentPhase === "plan" && selectedPlanId && detailParams.plan !== selectedPlanId) {
      navigate(getProjectPhasePath(projectId, "plan", { plan: selectedPlanId }), { replace: true });
      return;
    }

    if (
      currentPhase === "execute" &&
      previousPhase !== "execute" &&
      selectedTaskId &&
      detailParams.task !== selectedTaskId
    ) {
      navigate(getProjectPhasePath(projectId, "execute", { task: selectedTaskId }), {
        replace: true,
      });
    }
  }, [
    currentPhase,
    detailParams.plan,
    detailParams.task,
    navigate,
    projectId,
    selectedPlanId,
    selectedTaskId,
    redirectTo,
  ]);

  if (!projectId) return null;
  if (redirectTo) return <Navigate to={redirectTo} replace />;

  const handlePhaseChange = (phase: ProjectPhase) => {
    navigate(
      getProjectPhasePath(projectId, phase, {
        plan: phase === "plan" ? (selectedPlanId ?? undefined) : undefined,
        task: phase === "execute" ? (selectedTaskId ?? undefined) : undefined,
        feedback: phase === "eval" ? (selectedFeedbackId ?? undefined) : undefined,
      })
    );
  };

  const handleNavigateToBuildTask = (taskId: string) => {
    navigate(getProjectPhasePath(projectId, "execute", { task: taskId }));
  };

  const handleNavigateToPlan = (planId: string) => {
    navigate(getProjectPhasePath(projectId, "plan", { plan: planId }));
  };

  return (
    <div
      key={`${projectId}-${currentPhase}`}
      data-testid={`phase-${currentPhase}`}
      className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col"
    >
      <Suspense fallback={<PhaseLoadingFallback phase={currentPhase} />}>
        {currentPhase === "sketch" && (
          <LazySketchPhase
            projectId={projectId}
            onNavigateToPlan={() => handlePhaseChange("plan")}
          />
        )}
        {currentPhase === "plan" && (
          <LazyPlanPhase
            projectId={projectId}
            selectedPlanId={selectedPlanId ?? undefined}
            onSelectPlanId={(planId) =>
              navigate(
                getProjectPhasePath(projectId, "plan", {
                  plan: planId ?? undefined,
                })
              )
            }
            onNavigateToBuildTask={handleNavigateToBuildTask}
          />
        )}
        {currentPhase === "execute" && (
          <LazyExecutePhase
            projectId={projectId}
            selectedTaskId={selectedTaskId ?? undefined}
            onSelectTaskId={(taskId: string | null) =>
              navigate(
                getProjectPhasePath(projectId, "execute", {
                  task: taskId ?? undefined,
                })
              )
            }
            onNavigateToPlan={handleNavigateToPlan}
            onClose={() => navigate(getProjectPhasePath(projectId, "execute"))}
          />
        )}
        {currentPhase === "eval" && (
          <LazyEvalPhase
            projectId={projectId}
            onNavigateToBuildTask={handleNavigateToBuildTask}
            feedbackIdFromUrl={selectedFeedbackId ?? undefined}
          />
        )}
        {currentPhase === "deliver" && (
          <LazyDeliverPhase
            projectId={projectId}
            onOpenSettings={() => navigate(`/projects/${projectId}/settings?tab=deployment`)}
          />
        )}
      </Suspense>
    </div>
  );
}
