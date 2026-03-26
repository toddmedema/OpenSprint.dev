import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { shallowEqual } from "react-redux";
import { useQueryClient, useIsMutating } from "@tanstack/react-query";
import type { Plan, PlanExecuteBatchItem, PlanExecuteBatchStatus, PlanStatus } from "@opensprint/shared";
import { DEFAULT_MAX_TOTAL_CONCURRENT_AGENTS, sortPlansByStatus } from "@opensprint/shared";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../store";
import {
  executePlan,
  executePlanBatch,
  reExecutePlan,
  planTasks,
  fetchPlans,
  archivePlan,
  deletePlan,
  sendPlanMessage,
  updatePlan,
  setPlanChatMessages,
  generatePlan,
  setPlanError,
  setExecutingPlanId,
  clearExecuteError,
  enqueuePlanTasksId,
  addOptimisticPlan,
  setSinglePlan,
  setSelectedPlanId,
} from "../../store/slices/planSlice";
import { addNotification } from "../../store/slices/notificationSlice";
import { addNotification as addOpenQuestionNotification } from "../../store/slices/openQuestionsSlice";
import { clearPhaseUnread } from "../../store/slices/unreadPhaseSlice";
import {
  usePlanChat,
  useSinglePlan,
  usePlans,
  useMarkPlanComplete,
  useProjectSettings,
} from "../../api/hooks";
import { usePhaseLoadingState } from "../../hooks/usePhaseLoadingState";
import { PhaseLoadingSpinner } from "../../components/PhaseLoadingSpinner";
import { queryKeys } from "../../api/queryKeys";
import { api } from "../../api/client";
import { CloseButton } from "../../components/CloseButton";
import { CrossEpicConfirmModal } from "../../components/CrossEpicConfirmModal";
import { DependencyGraph } from "../../components/DependencyGraph";
import { PlanDetailContent } from "../../components/plan/PlanDetailContent";
import { AddPlanModal } from "../../components/plan/AddPlanModal";
import { PlanFilterToolbar, type PlanViewMode } from "../../components/plan/PlanFilterToolbar";
import { PlanListView } from "../../components/plan/PlanListView";
import { AuditorRunsSection } from "../../components/plan/AuditorRunsSection";
import { PhaseEmptyState, PhaseEmptyStateLogo } from "../../components/PhaseEmptyState";
import { ResizableSidebar } from "../../components/layout/ResizableSidebar";
import { ChatInput } from "../../components/ChatInput";
import { OpenQuestionsBlock } from "../../components/OpenQuestionsBlock";
import { selectTasksForEpic } from "../../store/slices/executeSlice";
import { wsSend, wsConnect } from "../../store/middleware/websocketMiddleware";
import { usePlanFilter } from "../../hooks/usePlanFilter";
import { chatDraftStorageKey, loadTextDraft } from "../../lib/agentInputDraftStorage";
import { useOptimisticTextDraft } from "../../hooks/useOptimisticTextDraft";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { VirtualizedAgentOutput } from "../../components/execute/VirtualizedAgentOutput";
import { CollapsibleSection } from "../../components/execute/CollapsibleSection";
import { formatUptime } from "../../lib/formatting";
import { EMPTY_STATE_COPY } from "../../lib/emptyStateCopy";
import { AGENT_ROLE_LABELS } from "@opensprint/shared";
import { useScrollToQuestion } from "../../hooks/useScrollToQuestion";
import { useOpenQuestionNotifications } from "../../hooks/useOpenQuestionNotifications";
import { formatPlanIdAsTitle } from "../../lib/formatting";
import { matchesPlanSearchQuery } from "../../lib/planSearchFilter";
import { parseDetailParams, getProjectPhasePath } from "../../lib/phaseRouting";
import { shouldRightAlignDropdown } from "../../lib/dropdownViewport";
import { PHASE_MAIN_SCROLL_CLASSNAME } from "../../lib/phaseMainScrollLayout";

async function pollPlanExecuteBatchUntilDone(
  projectId: string,
  batchId: string
): Promise<PlanExecuteBatchStatus> {
  for (;;) {
    const s = await api.plans.getExecuteBatchStatus(projectId, batchId);
    if (s.status !== "running") return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Display text for plan chat: show "Plan updated" when agent response contains [PLAN_UPDATE] */
export function getPlanChatMessageDisplay(content: string): string {
  return /\[PLAN_UPDATE\]/.test(content) ? "Plan updated" : content;
}

const EMPTY_PLAN_ID_LIST: string[] = [];
const EMPTY_OPTIMISTIC_PLAN_LIST: Plan[] = [];
const EMPTY_ACTIVE_AGENTS: {
  id: string;
  projectId: string;
  phase: string;
  role: string;
  label: string;
  startedAt: string;
  branchName?: string;
}[] = [];
const EMPTY_AUDITOR_OUTPUT_BY_PLAN_ID = Object.freeze({}) as Record<string, string>;

/** Auditor live output section — status indicator + streaming output (reuses Execute UX patterns). */
function PlanAuditorOutputSection({
  planId,
  auditorOutput,
  wsConnected,
  activeAuditor,
  onRetryConnect,
}: {
  planId: string;
  auditorOutput: string;
  wsConnected: boolean;
  activeAuditor?: { startedAt: string; label?: string };
  onRetryConnect: () => void;
}) {
  const [auditorExpanded, setAuditorExpanded] = useState(true);
  const {
    containerRef: liveOutputRef,
    showJumpToBottom,
    jumpToBottom,
    handleScroll: handleLiveOutputScroll,
  } = useAutoScroll({
    contentLength: auditorOutput.length,
    resetKey: planId,
  });

  const liveOutputContent =
    auditorOutput.length > 0 ? auditorOutput : !wsConnected ? "" : "Waiting for Auditor output...";

  return (
    <div className="border-b border-theme-border">
      <CollapsibleSection
        title="Auditor"
        expanded={auditorExpanded}
        onToggle={() => setAuditorExpanded((p) => !p)}
        expandAriaLabel="Expand Auditor output"
        collapseAriaLabel="Collapse Auditor output"
        contentId="auditor-output-content"
        headerId="auditor-output-header"
      >
        <div className="bg-theme-code-bg rounded-lg border border-theme-border overflow-hidden min-h-[160px] max-h-[320px] flex flex-col">
          {activeAuditor && (
            <div
              className="px-3 py-1.5 rounded-t-lg bg-theme-warning-bg border-b border-theme-warning-border text-xs font-medium text-theme-warning-text flex items-center gap-3 min-w-0"
              data-testid="plan-auditor-active-callout"
            >
              <span className="truncate">
                {AGENT_ROLE_LABELS.auditor ?? "Auditor"}
                {activeAuditor.label && ` · ${activeAuditor.label}`}
                {activeAuditor.startedAt && <> · {formatUptime(activeAuditor.startedAt)}</>}
              </span>
            </div>
          )}
          {!wsConnected ? (
            <div className="p-4 flex flex-col gap-3" data-testid="plan-auditor-connecting">
              <div className="text-sm text-theme-muted flex items-center gap-2">
                <span
                  className="inline-block w-4 h-4 border-2 border-theme-border border-t-brand-500 rounded-full animate-spin"
                  aria-hidden
                />
                Connecting to live output…
              </div>
              <button
                type="button"
                onClick={onRetryConnect}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline self-start"
                data-testid="plan-auditor-retry-connect"
              >
                Retry connection
              </button>
            </div>
          ) : (
            <div className="relative flex flex-col min-h-0 flex-1">
              <VirtualizedAgentOutput
                content={liveOutputContent}
                mode="stream"
                containerRef={liveOutputRef}
                onScroll={handleLiveOutputScroll}
                data-testid="plan-auditor-output"
              />
              {showJumpToBottom && (
                <button
                  type="button"
                  onClick={jumpToBottom}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 text-xs font-medium rounded-full bg-theme-surface border border-theme-border text-theme-text shadow-md hover:bg-theme-border-subtle/50 transition-colors z-10"
                  data-testid="plan-auditor-jump-to-bottom"
                  aria-label="Jump to bottom"
                >
                  Jump to bottom
                </button>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}

/** Topological order for plan IDs: prerequisites first. Edge (from, to) means "from blocks to". */
function topologicalPlanOrder(planIds: string[], edges: { from: string; to: string }[]): string[] {
  const idSet = new Set(planIds);
  const outgoing = new Map<string, string[]>();
  for (const id of planIds) outgoing.set(id, []);
  for (const e of edges) {
    if (idSet.has(e.from) && idSet.has(e.to)) {
      outgoing.get(e.from)!.push(e.to);
    }
  }
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const to of outgoing.get(id) ?? []) visit(to);
    order.push(id);
  };
  for (const id of planIds) visit(id);
  order.reverse();
  return order;
}

interface PlanPhaseProps {
  projectId: string;
  selectedPlanId?: string;
  onSelectPlanId?: (planId: string | null) => void;
  onNavigateToBuildTask?: (taskId: string) => void;
}

export function PlanPhase({
  projectId,
  selectedPlanId: propSelectedPlanId,
  onSelectPlanId,
  onNavigateToBuildTask,
}: PlanPhaseProps) {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const selectedPlanIdFromStore = useAppSelector((s) => s.plan.selectedPlanId);
  const selectedPlanId = propSelectedPlanId ?? selectedPlanIdFromStore ?? null;
  const [selectedDraftPlanId, setSelectedDraftPlanId] = useState<string | null>(null);

  useEffect(() => {
    dispatch(clearPhaseUnread({ projectId, phase: "plan" }));
  }, [dispatch, projectId, queryClient]);

  useEffect(() => {
    if (propSelectedPlanId === undefined || selectedPlanIdFromStore === propSelectedPlanId) return;
    if (propSelectedPlanId) {
      setSelectedDraftPlanId(null);
    }
    dispatch(setSelectedPlanId(propSelectedPlanId ?? null));
  }, [dispatch, propSelectedPlanId, selectedPlanIdFromStore]);

  /* ── TanStack Query for loading state (data synced to Redux by ProjectShell) ── */
  const plansQuery = usePlans(projectId);
  const decomposeMutationsInFlight = useIsMutating({
    mutationKey: queryKeys.plans.decompose(projectId),
  });
  const markPlanCompleteMutation = useMarkPlanComplete(projectId);
  const { data: projectSettings } = useProjectSettings(projectId);
  const autoExecutePlans = projectSettings?.autoExecutePlans === true;

  /* ── Redux state (needed for hook args) ── */
  const planChatQuery = usePlanChat(
    projectId,
    selectedPlanId
      ? `plan:${selectedPlanId}`
      : selectedDraftPlanId
        ? `plan-draft:${selectedDraftPlanId}`
        : undefined
  );
  const singlePlanQuery = useSinglePlan(projectId, selectedPlanId ?? undefined);
  const selectedPlanIdRef = useRef<string | null>(selectedPlanId ?? null);

  useEffect(() => {
    selectedPlanIdRef.current = selectedPlanId ?? null;
  }, [selectedPlanId]);

  useEffect(() => {
    if (planChatQuery.data) {
      dispatch(
        setPlanChatMessages({
          context: planChatQuery.data.context,
          messages: planChatQuery.data.messages,
        })
      );
    }
  }, [planChatQuery.data, dispatch]);

  useEffect(() => {
    if (singlePlanQuery.data) dispatch(setSinglePlan(singlePlanQuery.data));
  }, [singlePlanQuery.data, dispatch]);

  /* ── Redux state ── */
  const plans = useAppSelector((s) => s.plan.plans);
  const dependencyGraph = useAppSelector((s) => s.plan.dependencyGraph);
  const chatMessages = useAppSelector((s) => s.plan.chatMessages);
  const executingPlanId = useAppSelector((s) => s.plan.executingPlanId);
  const reExecutingPlanId = useAppSelector((s) => s.plan.reExecutingPlanId);
  const planTasksPlanIds = useAppSelector((s) => s.plan.planTasksPlanIds ?? EMPTY_PLAN_ID_LIST);
  const auditorOutputByPlanId = useAppSelector(
    (s) => s.plan.auditorOutputByPlanId ?? EMPTY_AUDITOR_OUTPUT_BY_PLAN_ID
  );
  const wsConnected = useAppSelector((s) => s.websocket?.connected ?? false);
  const activeAgents = useAppSelector((s) => s.execute?.activeAgents ?? EMPTY_ACTIVE_AGENTS);
  const archivingPlanId = useAppSelector((s) => s.plan.archivingPlanId);
  const deletingPlanId = useAppSelector((s) => s.plan.deletingPlanId);
  const optimisticPlans = useAppSelector(
    (s) => s.plan.optimisticPlans ?? EMPTY_OPTIMISTIC_PLAN_LIST
  );
  const decomposeGeneratedCount = useAppSelector((s) => s.plan.decomposeGeneratedCount ?? 0);
  const decomposeTotalCount = useAppSelector((s) => s.plan.decomposeTotalCount ?? null);
  const planError = useAppSelector((s) => s.plan.error);
  const executeError = useAppSelector((s) => s.plan.executeError);

  const selectedPlan = plans.find((p) => p.metadata.planId === selectedPlanId) ?? null;
  /* ── Memoized task selectors (only re-render when tasks for current plan change) ── */
  const selectedPlanTasks = useAppSelector(
    (s) => selectTasksForEpic(s, selectedPlan?.metadata.epicId),
    shallowEqual
  );

  /* ── Local UI state (preserved by mount-all) ── */
  const [addPlanModalOpen, setAddPlanModalOpen] = useState(false);
  const [crossEpicModal, setCrossEpicModal] = useState<{
    planId: string;
    prerequisitePlanIds: string[];
  } | null>(null);
  const [deleteConfirmPlanId, setDeleteConfirmPlanId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | PlanStatus>("all");
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [tasksSectionExpanded, setTasksSectionExpanded] = useState(true);
  const [mockupsSectionExpanded, setMockupsSectionExpanded] = useState(true);
  const [refineSectionExpanded, setRefineSectionExpanded] = useState(true);
  const [viewMode, setViewMode] = useState<PlanViewMode>(() => {
    if (typeof window === "undefined") return "card";
    try {
      const stored = localStorage.getItem("opensprint.planView");
      return stored === "card" || stored === "graph" ? stored : "card";
    } catch {
      return "card";
    }
  });
  const [savingPlanContentId, setSavingPlanContentId] = useState<string | null>(null);
  const [planAllInProgress, setPlanAllInProgress] = useState(false);
  const [executeAllInProgress, setExecuteAllInProgress] = useState(false);
  /** If the user refreshes while a server-side execute-all batch is running, reattach and poll to completion. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const active = await api.plans.getActiveExecuteBatch(projectId);
        if (cancelled || !active || active.status !== "running") return;
        setExecuteAllInProgress(true);
        try {
          const final = await pollPlanExecuteBatchUntilDone(projectId, active.batchId);
          if (cancelled) return;
          void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
          if (final.status === "failed" && final.errorMessage) {
            dispatch(addNotification({ message: final.errorMessage, severity: "error" }));
          }
        } finally {
          if (!cancelled) setExecuteAllInProgress(false);
        }
      } catch {
        // Older server or transient errors — ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, dispatch, queryClient]);
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<number | null>(null);
  const [planActionsMenuOpen, setPlanActionsMenuOpen] = useState(false);
  const planActionsMenuRef = useRef<HTMLDivElement>(null);
  const planActionsMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedVersionNumber(null);
    setPlanActionsMenuOpen(false);
  }, [selectedPlanId]);

  useEffect(() => {
    if (!planActionsMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (planActionsMenuRef.current && !planActionsMenuRef.current.contains(e.target as Node)) {
        setPlanActionsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [planActionsMenuOpen]);

  const [planActionsMenuAlignRight, setPlanActionsMenuAlignRight] = useState(false);
  useEffect(() => {
    if (planActionsMenuOpen && planActionsMenuTriggerRef.current) {
      setPlanActionsMenuAlignRight(
        shouldRightAlignDropdown(planActionsMenuTriggerRef.current.getBoundingClientRect())
      );
    }
  }, [planActionsMenuOpen]);

  const {
    searchExpanded,
    searchInputValue,
    setSearchInputValue,
    searchQuery,
    searchInputRef,
    isSearchActive,
    handleSearchExpand,
    handleSearchClose,
    handleSearchKeyDown,
  } = usePlanFilter();
  useScrollToQuestion();
  const { notifications: openQuestionNotifications, refetch: refetchNotifications } =
    useOpenQuestionNotifications(projectId);
  const selectedPlanNotification =
    (selectedPlanId &&
      openQuestionNotifications.find(
        (n) => n.source === "plan" && n.sourceId === selectedPlanId
      )) ??
    null;
  const activeQuestionId = parseDetailParams(location.search).question;
  const draftPlanNotifications = useMemo(
    () =>
      openQuestionNotifications.filter(
        (n) => n.source === "plan" && n.sourceId.startsWith("draft:")
      ),
    [openQuestionNotifications]
  );
  const draftPlanNotification = useMemo(() => {
    if (activeQuestionId) {
      const matching = draftPlanNotifications.find((n) => n.id === activeQuestionId);
      if (matching) return matching;
    }
    return draftPlanNotifications[0] ?? null;
  }, [activeQuestionId, draftPlanNotifications]);
  const fallbackDraftPlanId =
    !selectedPlanId && draftPlanNotification?.sourceId?.startsWith("draft:")
      ? draftPlanNotification.sourceId.replace(/^draft:/, "")
      : null;
  const activeDraftPlanId = selectedDraftPlanId ?? fallbackDraftPlanId;
  const selectedDraftNotification =
    (activeDraftPlanId &&
      openQuestionNotifications.find(
        (n) => n.source === "plan" && n.sourceId === `draft:${activeDraftPlanId}`
      )) ??
    null;
  const sidebarOpenQuestionNotification =
    draftPlanNotification ?? (selectedPlanNotification ?? selectedDraftNotification);
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const prevChatMessageCountRef = useRef(0);

  useEffect(() => {
    if (!selectedDraftPlanId && fallbackDraftPlanId) {
      setSelectedDraftPlanId(fallbackDraftPlanId);
    }
  }, [fallbackDraftPlanId, selectedDraftPlanId]);

  const planQueueRef = useRef<string[]>([]);
  const processingQueueRef = useRef(false);
  const generateQueueRef = useRef<
    Array<{ description: string; tempId: string; resolve?: (ok: boolean) => void }>
  >([]);
  const processingGenerateRef = useRef(false);

  const filteredAndSortedPlans = useMemo(() => {
    let filtered = statusFilter === "all" ? plans : plans.filter((p) => p.status === statusFilter);
    if (searchQuery.trim()) {
      filtered = filtered.filter((p) => matchesPlanSearchQuery(p, searchQuery));
    }
    return sortPlansByStatus(filtered);
  }, [plans, statusFilter, searchQuery]);

  /** Plans to show in list view: optimistic (planning) first when filter includes planning, then filtered. */
  const plansForListView = useMemo(() => {
    const showOptimistic = statusFilter === "all" || statusFilter === "planning";
    if (!showOptimistic || optimisticPlans.length === 0) return filteredAndSortedPlans;
    const optimisticAsPlans: Plan[] = optimisticPlans.map((opt) => ({
      metadata: {
        planId: opt.title,
        epicId: opt.tempId,
        shippedAt: null,
        complexity: "medium",
      },
      content: "",
      status: "planning" as const,
      taskCount: 0,
      doneTaskCount: 0,
      dependencyCount: 0,
    }));
    return [...optimisticAsPlans, ...filteredAndSortedPlans];
  }, [filteredAndSortedPlans, optimisticPlans, statusFilter]);

  const plansEmpty = plans.length === 0 && optimisticPlans.length === 0;

  /** After decompose finishes, Redux may lag the plans query refetch — keep full-page generating until list fetch settles. */
  const [awaitingPlansAfterDecompose, setAwaitingPlansAfterDecompose] = useState(false);
  const prevDecomposeMutatingRef = useRef(0);
  const sawPlansFetchAfterAwaitingRef = useRef(false);

  useEffect(() => {
    const prev = prevDecomposeMutatingRef.current;
    const now = decomposeMutationsInFlight;
    if (prev > 0 && now === 0 && plansEmpty) {
      sawPlansFetchAfterAwaitingRef.current = false;
      setAwaitingPlansAfterDecompose(true);
    }
    prevDecomposeMutatingRef.current = now;
  }, [decomposeMutationsInFlight, plansEmpty]);

  useEffect(() => {
    if (!plansEmpty) {
      setAwaitingPlansAfterDecompose(false);
      sawPlansFetchAfterAwaitingRef.current = false;
    }
  }, [plansEmpty]);

  useEffect(() => {
    if (!awaitingPlansAfterDecompose) return;
    if (plansQuery.isFetching) {
      sawPlansFetchAfterAwaitingRef.current = true;
      return;
    }
    if (sawPlansFetchAfterAwaitingRef.current) {
      setAwaitingPlansAfterDecompose(false);
      sawPlansFetchAfterAwaitingRef.current = false;
    }
  }, [awaitingPlansAfterDecompose, plansQuery.isFetching]);

  useEffect(() => {
    if (!awaitingPlansAfterDecompose) return;
    const t = window.setTimeout(() => {
      setAwaitingPlansAfterDecompose(false);
      sawPlansFetchAfterAwaitingRef.current = false;
    }, 15_000);
    return () => window.clearTimeout(t);
  }, [awaitingPlansAfterDecompose]);

  const generatingPlansFromPrd =
    plansEmpty && (decomposeMutationsInFlight > 0 || awaitingPlansAfterDecompose);

  const { showSpinner: showPlansSpinner, showEmptyState: showPlansEmptyState } =
    usePhaseLoadingState(plansQuery.isLoading, plansEmpty);

  /** Process the generate-plan queue sequentially (one at a time). */
  const processGenerateQueue = useCallback(async () => {
    if (processingGenerateRef.current || generateQueueRef.current.length === 0) return;
    processingGenerateRef.current = true;
    try {
      while (generateQueueRef.current.length > 0) {
        const { description, tempId, resolve } = generateQueueRef.current[0];
        generateQueueRef.current = generateQueueRef.current.slice(1);
        const result = await dispatch(generatePlan({ projectId, description, tempId }));
        if (generatePlan.fulfilled.match(result)) {
          if (result.payload.status === "created") {
            resolve?.(true);
            void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
          } else {
            // Clarification flow continues in the sidebar (plan-draft context), not the modal.
            resolve?.(true);
            setSelectedDraftPlanId(result.payload.draftId);
            dispatch(setSelectedPlanId(null));
            onSelectPlanId?.(null);
            dispatch(addOpenQuestionNotification(result.payload.notification));
            dispatch(
              addNotification({
                message: "Planner needs clarification before generating this plan",
                severity: "info",
              })
            );
            void refetchNotifications();
          }
        } else {
          resolve?.(false);
          if (generatePlan.rejected.match(result)) {
            dispatch(
              addNotification({
                message: result.error?.message || "Failed to generate plan",
                severity: "error",
              })
            );
          }
        }
      }
    } finally {
      processingGenerateRef.current = false;
    }
  }, [dispatch, onSelectPlanId, projectId, queryClient, refetchNotifications]);

  const planCountByStatus = useMemo(() => {
    const counts = { all: plans.length, planning: 0, building: 0, in_review: 0, complete: 0 };
    for (const p of plans) {
      if (p.status === "planning") counts.planning += 1;
      else if (p.status === "building") counts.building += 1;
      else if (p.status === "in_review") counts.in_review += 1;
      else if (p.status === "complete") counts.complete += 1;
    }
    return counts;
  }, [plans]);

  // Reset to "all" when the selected filter chip is hidden (count 0)
  useEffect(() => {
    if (statusFilter === "all") return;
    const count = planCountByStatus[statusFilter];
    if (count === 0) setStatusFilter("all");
  }, [statusFilter, planCountByStatus]);

  const filteredDependencyGraph = useMemo(() => {
    if (!dependencyGraph) return null;
    let filteredPlans =
      statusFilter === "all"
        ? dependencyGraph.plans
        : dependencyGraph.plans.filter((p) => p.status === statusFilter);
    if (searchQuery.trim()) {
      filteredPlans = filteredPlans.filter((p) => matchesPlanSearchQuery(p, searchQuery));
    }
    const filteredPlanIds = new Set(filteredPlans.map((p) => p.metadata.planId));
    const filteredEdges = dependencyGraph.edges.filter(
      (e) => filteredPlanIds.has(e.from) && filteredPlanIds.has(e.to)
    );
    return {
      plans: sortPlansByStatus(filteredPlans),
      edges: filteredEdges,
    };
  }, [dependencyGraph, statusFilter, searchQuery]);

  /** Plans that show "Generate Tasks" (planning status, zero tasks). Used for "Generate All Tasks" button. */
  const plansWithNoTasks = useMemo(() => {
    return plans.filter((p) => p.status === "planning" && p.taskCount === 0);
  }, [plans]);

  /** Plan IDs for "Generate All Tasks" in dependency order (foundational first), or current order if no edges. */
  const plansWithNoTasksOrderedIds = useMemo(() => {
    const ids = plansWithNoTasks.map((p) => p.metadata.planId);
    if (dependencyGraph?.edges?.length) {
      return topologicalPlanOrder(ids, dependencyGraph.edges);
    }
    return ids;
  }, [plansWithNoTasks, dependencyGraph?.edges]);

  /** Plans that show "Execute" (planning, has ≥1 task). Used for "Execute All" button. */
  const plansReadyToExecute = useMemo(() => {
    return plans.filter((p) => p.status === "planning" && p.taskCount > 0);
  }, [plans]);

  /** Plan IDs for "Execute All" in dependency order (foundational first). */
  const plansReadyToExecuteOrderedIds = useMemo(() => {
    const ids = plansReadyToExecute.map((p) => p.metadata.planId);
    if (dependencyGraph?.edges?.length) {
      return topologicalPlanOrder(ids, dependencyGraph.edges);
    }
    return ids;
  }, [plansReadyToExecute, dependencyGraph?.edges]);

  /** When autoExecutePlans: all planning plans in dependency order (no-task plans get generate+execute, others just execute). */
  const plansEligibleForExecuteAllOrderedIds = useMemo(() => {
    const ids = plans.filter((p) => p.status === "planning").map((p) => p.metadata.planId);
    if (dependencyGraph?.edges?.length) {
      return topologicalPlanOrder(ids, dependencyGraph.edges);
    }
    return ids;
  }, [plans, dependencyGraph?.edges]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("opensprint.planView", viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  // Use selectedPlanId when available so chat can display even before plans load (e.g. deep link)
  const planContext =
    selectedPlanId && !sidebarOpenQuestionNotification?.sourceId?.startsWith("draft:")
      ? `plan:${selectedPlanId}`
      : null;
  const notificationDraftPlanId =
    !selectedPlanId &&
    sidebarOpenQuestionNotification?.sourceId?.startsWith("draft:")
      ? sidebarOpenQuestionNotification.sourceId.replace(/^draft:/, "")
      : null;
  const effectiveDraftPlanId = activeDraftPlanId ?? notificationDraftPlanId;
  const draftPlanContext = effectiveDraftPlanId ? `plan-draft:${effectiveDraftPlanId}` : null;
  const activePlanContext = planContext ?? draftPlanContext;
  const planChatDraftKey = useMemo(
    () => (activePlanContext ? chatDraftStorageKey(projectId, activePlanContext) : undefined),
    [projectId, activePlanContext]
  );
  const { beginSend, onSuccess, onFailure } = useOptimisticTextDraft(
    planChatDraftKey,
    chatInput,
    setChatInput
  );
  const currentChatMessages = useMemo(
    () => (activePlanContext ? (chatMessages[activePlanContext] ?? []) : []),
    [activePlanContext, chatMessages]
  );

  // Plan chat and single plan are loaded via usePlanChat / useSinglePlan and synced to Redux above.

  // When sidebar opens: scroll to top of plan content, no animation
  useEffect(() => {
    if (activePlanContext) {
      prevChatMessageCountRef.current = 0;
      const el = sidebarScrollRef.current;
      if (el) {
        el.scrollTop = 0;
      }
    }
  }, [activePlanContext]);

  useLayoutEffect(() => {
    if (!activePlanContext) {
      setChatInput("");
      return;
    }
    setChatInput(loadTextDraft(chatDraftStorageKey(projectId, activePlanContext)));
  }, [projectId, activePlanContext]);

  // Auto-scroll chat to bottom only when new messages arrive (not on initial open)
  useEffect(() => {
    const prev = prevChatMessageCountRef.current;
    const curr = currentChatMessages.length;
    prevChatMessageCountRef.current = curr;
    if (prev > 0 && curr > prev) {
      const el = messagesEndRef.current;
      if (el?.scrollIntoView) {
        el.scrollIntoView({ behavior: "auto" });
      }
    }
  }, [currentChatMessages]);

  // Subscribe to Auditor output when Re-execute is in progress
  const prevReExecutingPlanIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevReExecutingPlanIdRef.current;
    const curr = reExecutingPlanId;
    prevReExecutingPlanIdRef.current = curr;

    if (prev && !curr) {
      dispatch(wsSend({ type: "plan.agent.unsubscribe", planId: prev }));
    }
    if (curr) {
      dispatch(wsSend({ type: "plan.agent.subscribe", planId: curr }));
    }
  }, [reExecutingPlanId, dispatch]);

  const handleShip = async (planId: string, versionNumber?: number) => {
    dispatch(setExecutingPlanId(planId));
    try {
      const deps = await api.plans.getCrossEpicDependencies(projectId, planId);
      if (deps.prerequisitePlanIds.length > 0) {
        dispatch(setExecutingPlanId(null));
        setCrossEpicModal({ planId, prerequisitePlanIds: deps.prerequisitePlanIds });
        return;
      }
    } catch {
      // Cross-epic deps check failed; proceed with execute
    }
    const result = await dispatch(
      executePlan({ projectId, planId, version_number: versionNumber })
    );
    if (executePlan.fulfilled.match(result)) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
    }
  };

  /** When autoExecutePlans: generate tasks then execute in one step for a single plan. */
  const handleShipOrGenerateAndShip = async (plan: Plan) => {
    if (plan.taskCount === 0) {
      dispatch(setExecutingPlanId(plan.metadata.planId));
      const result = await dispatch(planTasks({ projectId, planId: plan.metadata.planId }));
      if (!planTasks.fulfilled.match(result)) {
        dispatch(setExecutingPlanId(null));
        dispatch(
          addNotification({
            message: result.error?.message ?? "Failed to generate tasks",
            severity: "error",
          })
        );
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.plans.detail(projectId, plan.metadata.planId),
      });
      await handleShip(plan.metadata.planId);
    } else {
      await handleShip(plan.metadata.planId, plan.lastExecutedVersionNumber);
    }
  };

  const handleCrossEpicConfirm = async () => {
    if (!crossEpicModal) return;
    const { planId, prerequisitePlanIds } = crossEpicModal;
    setCrossEpicModal(null);
    const plan = plans.find((p) => p.metadata.planId === planId);
    const versionNumber = plan?.lastExecutedVersionNumber;
    const result = await dispatch(
      executePlan({ projectId, planId, prerequisitePlanIds, version_number: versionNumber })
    );
    if (executePlan.fulfilled.match(result)) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
    }
  };

  /** When unset, cap in-flight planTasks HTTP calls during bulk generate (backend still enforces maxTotalConcurrentAgents when set). */

  /** Process the shared plan-tasks queue with bounded parallelism (FIFO). */
  const processQueue = useCallback(async () => {
    if (processingQueueRef.current) return;
    processingQueueRef.current = true;
    let completed = 0;
    try {
      while (planQueueRef.current.length > 0) {
        const batchConcurrency = Math.max(
          1,
          Math.min(
            planQueueRef.current.length,
            projectSettings?.maxTotalConcurrentAgents ?? DEFAULT_MAX_TOTAL_CONCURRENT_AGENTS
          )
        );

        const runWorker = async () => {
          for (;;) {
            const planId = planQueueRef.current.shift();
            if (!planId) break;
            const result = await dispatch(planTasks({ projectId, planId }));
            dispatch(fetchPlans({ projectId, background: true }));
            const currentSelected = selectedPlanIdRef.current;
            if (currentSelected === planId) {
              void queryClient.invalidateQueries({
                queryKey: queryKeys.plans.detail(projectId, planId),
              });
            }
            if (planTasks.fulfilled.match(result)) {
              completed += 1;
            } else if (planTasks.rejected.match(result)) {
              dispatch(
                addNotification({
                  message: result.error?.message ?? "Failed to generate tasks",
                  severity: "error",
                })
              );
            }
          }
        };

        await Promise.all(Array.from({ length: batchConcurrency }, () => runWorker()));
      }

      if (completed > 0) {
        dispatch(
          addNotification({
            message:
              completed === 1
                ? "Tasks generated successfully"
                : `Tasks generated for ${completed} plans`,
            severity: "success",
          })
        );
      }
    } finally {
      processingQueueRef.current = false;
      setPlanAllInProgress(false);
    }
  }, [dispatch, projectId, queryClient, projectSettings?.maxTotalConcurrentAgents]);

  const enqueuePlan = useCallback(
    (planId: string) => {
      if (planQueueRef.current.includes(planId)) return;
      dispatch(enqueuePlanTasksId(planId));
      planQueueRef.current = [...planQueueRef.current, planId];
      processQueue();
    },
    [dispatch, processQueue]
  );

  const handlePlanTasks = (planId: string) => {
    enqueuePlan(planId);
  };

  /**
   * Queue all plans with no tasks (dependency order: foundational first in the shared queue).
   * Append every id before calling `processQueue` once so the worker pool sees the full queue and
   * `batchConcurrency` is not stuck at 1 (calling `enqueuePlan` in a loop used to start processing
   * after only the first id was appended).
   */
  const handlePlanAllTasks = () => {
    if (plansWithNoTasksOrderedIds.length === 0 || planAllInProgress) return;
    setPlanAllInProgress(true);
    for (const planId of plansWithNoTasksOrderedIds) {
      if (planQueueRef.current.includes(planId)) continue;
      dispatch(enqueuePlanTasksId(planId));
      planQueueRef.current = [...planQueueRef.current, planId];
    }
    void processQueue();
  };

  /** Execute all plans ready to execute, in dependency order. Stops and opens cross-epic modal if a plan has deps outside the batch. */
  const handleExecuteAll = async () => {
    if (plansReadyToExecuteOrderedIds.length === 0 || executeAllInProgress || !!executingPlanId)
      return;
    setExecuteAllInProgress(true);
    const batchSet = new Set(plansReadyToExecuteOrderedIds);
    try {
      const items: PlanExecuteBatchItem[] = [];
      for (const planId of plansReadyToExecuteOrderedIds) {
        const deps = await api.plans.getCrossEpicDependencies(projectId, planId);
        const outsideBatch = deps.prerequisitePlanIds.filter((id) => !batchSet.has(id));
        if (outsideBatch.length > 0) {
          setCrossEpicModal({ planId, prerequisitePlanIds: deps.prerequisitePlanIds });
          return;
        }
        const plan = plansReadyToExecute.find((p) => p.metadata.planId === planId);
        const versionNumber = plan?.lastExecutedVersionNumber;
        const item: PlanExecuteBatchItem = { planId };
        if (deps.prerequisitePlanIds.length > 0) item.prerequisitePlanIds = deps.prerequisitePlanIds;
        if (versionNumber != null) item.version_number = versionNumber;
        items.push(item);
      }
      const result = await dispatch(executePlanBatch({ projectId, items }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
      if (executePlanBatch.rejected.match(result)) {
        dispatch(
          addNotification({
            message: result.error?.message ?? "Execute all failed to start",
            severity: "error",
          })
        );
        return;
      }
      const { batchId } = result.payload;
      const final = await pollPlanExecuteBatchUntilDone(projectId, batchId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
      if (final.status === "failed" && final.errorMessage) {
        dispatch(addNotification({ message: final.errorMessage, severity: "error" }));
      }
    } finally {
      setExecuteAllInProgress(false);
    }
  };

  /** When autoExecutePlans: generate-then-execute for no-task plans, execute for rest; in dependency order. */
  const handleExecuteAllOrGenerateAndExecute = async () => {
    if (
      plansEligibleForExecuteAllOrderedIds.length === 0 ||
      executeAllInProgress ||
      !!executingPlanId
    )
      return;
    setExecuteAllInProgress(true);
    const batchSet = new Set(plansEligibleForExecuteAllOrderedIds);
    try {
      for (const planId of plansEligibleForExecuteAllOrderedIds) {
        const plan = plans.find((p) => p.metadata.planId === planId);
        if (!plan) continue;
        if (plan.taskCount === 0) {
          const ptResult = await dispatch(planTasks({ projectId, planId }));
          if (!planTasks.fulfilled.match(ptResult)) {
            dispatch(
              addNotification({
                message: ptResult.error?.message ?? "Failed to generate tasks",
                severity: "error",
              })
            );
            return;
          }
          void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
        }
      }
      const graph = await queryClient.fetchQuery({
        queryKey: queryKeys.plans.list(projectId),
        queryFn: () => api.plans.list(projectId),
      });
      const freshPlans = graph.plans;
      const items: PlanExecuteBatchItem[] = [];
      for (const planId of plansEligibleForExecuteAllOrderedIds) {
        const p = freshPlans.find((x) => x.metadata.planId === planId);
        if (!p || p.taskCount === 0) {
          dispatch(
            addNotification({
              message: "A plan still has no tasks after generation; cannot execute all.",
              severity: "error",
            })
          );
          return;
        }
        const deps = await api.plans.getCrossEpicDependencies(projectId, planId);
        const outsideBatch = deps.prerequisitePlanIds.filter((id) => !batchSet.has(id));
        if (outsideBatch.length > 0) {
          setCrossEpicModal({ planId, prerequisitePlanIds: deps.prerequisitePlanIds });
          return;
        }
        const item: PlanExecuteBatchItem = { planId };
        if (deps.prerequisitePlanIds.length > 0) item.prerequisitePlanIds = deps.prerequisitePlanIds;
        if (p.lastExecutedVersionNumber != null) item.version_number = p.lastExecutedVersionNumber;
        items.push(item);
      }
      const result = await dispatch(executePlanBatch({ projectId, items }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
      if (executePlanBatch.rejected.match(result)) {
        dispatch(
          addNotification({
            message: result.error?.message ?? "Execute all failed to start",
            severity: "error",
          })
        );
        return;
      }
      const { batchId } = result.payload;
      const final = await pollPlanExecuteBatchUntilDone(projectId, batchId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
      if (final.status === "failed" && final.errorMessage) {
        dispatch(addNotification({ message: final.errorMessage, severity: "error" }));
      }
    } finally {
      setExecuteAllInProgress(false);
    }
  };

  const handleReship = async (planId: string) => {
    const result = await dispatch(reExecutePlan({ projectId, planId }));
    if (reExecutePlan.fulfilled.match(result)) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
    }
  };

  const handleArchive = async (planId: string) => {
    const result = await dispatch(archivePlan({ projectId, planId }));
    if (archivePlan.fulfilled.match(result)) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.detail(projectId, planId) });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmPlanId) return;
    const result = await dispatch(deletePlan({ projectId, planId: deleteConfirmPlanId }));
    if (deletePlan.fulfilled.match(result)) {
      setDeleteConfirmPlanId(null);
      dispatch(setSelectedPlanId(null));
      onSelectPlanId?.(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list(projectId) });
    } else {
      dispatch(
        addNotification({
          message: result.error?.message ?? "Failed to delete plan",
          severity: "error",
        })
      );
    }
  };

  const handleGeneratePlan = useCallback(
    (description: string): Promise<boolean> => {
      const trimmed = description.trim();
      if (!trimmed) return Promise.resolve(false);

      const title = trimmed.slice(0, 45);
      const tempId = `opt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      dispatch(addOptimisticPlan({ tempId, title }));
      return new Promise<boolean>((resolve) => {
        generateQueueRef.current = [
          ...generateQueueRef.current,
          { description: trimmed, tempId, resolve },
        ];
        processGenerateQueue();
      });
    },
    [dispatch, processGenerateQueue]
  );

  const handleSelectPlan = useCallback(
    (plan: Plan) => {
      setSelectedDraftPlanId(null);
      dispatch(setSelectedPlanId(plan.metadata.planId));
      onSelectPlanId?.(plan.metadata.planId);
    },
    [dispatch, onSelectPlanId]
  );

  const handleClosePlan = useCallback(() => {
    setSelectedDraftPlanId(null);
    dispatch(setSelectedPlanId(null));
    onSelectPlanId?.(null);
  }, [dispatch, onSelectPlanId]);

  const handlePlanContentSave = useCallback(
    async (content: string) => {
      if (!selectedPlanId) return;
      setSavingPlanContentId(selectedPlanId);
      const result = await dispatch(updatePlan({ projectId, planId: selectedPlanId, content }));
      setSavingPlanContentId(null);
      if (updatePlan.fulfilled.match(result)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
      }
    },
    [dispatch, projectId, queryClient, selectedPlanId]
  );

  const handleSendChat = async () => {
    if (!chatInput.trim() || !activePlanContext || chatSending) return;

    const text = chatInput.trim();
    setChatSending(true);
    beginSend(text);

    const result = await dispatch(
      sendPlanMessage({ projectId, message: text, context: activePlanContext })
    );

    if (sendPlanMessage.fulfilled.match(result)) {
      onSuccess();
      const response = result.payload?.response;
      if (response?.planGenerated?.planId) {
        const generatedPlanId = response.planGenerated.planId;
        setSelectedDraftPlanId(null);
        dispatch(setSelectedPlanId(generatedPlanId));
        onSelectPlanId?.(generatedPlanId);
        void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.plans.detail(projectId, generatedPlanId),
        });
      }
      if (response?.planUpdate && selectedPlanId) {
        await dispatch(
          updatePlan({ projectId, planId: selectedPlanId, content: response.planUpdate })
        );
        void queryClient.invalidateQueries({
          queryKey: queryKeys.plans.versions(projectId, selectedPlanId),
        });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
      if (selectedPlanId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.plans.detail(projectId, selectedPlanId!),
        });
      }
      // Refetch chat history so persisted messages are authoritative in Redux (survives reload)
      void planChatQuery.refetch();
    } else {
      onFailure();
    }

    setChatSending(false);
  };

  /* ── RENDER: Centered pulsing logo + status during fetch or PRD→plans decomposition ── */
  const showPlansBlockingSpinner = showPlansSpinner || generatingPlansFromPrd;
  const plansBlockingStatus = generatingPlansFromPrd
    ? decomposeMutationsInFlight > 0
      ? (decomposeTotalCount ?? 0) > 0
        ? decomposeGeneratedCount >= decomposeTotalCount!
          ? `Finalizing ${decomposeTotalCount} generated ${
              decomposeTotalCount === 1 ? "plan" : "plans"
            }...`
          : `Generating Plan #${decomposeGeneratedCount + 1}/${decomposeTotalCount}...`
        : "Generating Plan..."
      : decomposeGeneratedCount > 0
        ? `Loading ${decomposeGeneratedCount} generated ${
            decomposeGeneratedCount === 1 ? "plan" : "plans"
          }...`
        : "Generating Plan..."
    : "Loading plans…";
  const plansBlockingAriaLabel = generatingPlansFromPrd ? "Generating plan" : "Loading plans";

  if (showPlansBlockingSpinner) {
    return (
      <div
        className="flex flex-1 min-h-0 items-center justify-center"
        data-testid="plan-phase-loading"
      >
        <PhaseLoadingSpinner
          data-testid="plan-phase-loading-spinner"
          aria-label={plansBlockingAriaLabel}
          status={plansBlockingStatus}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <PlanFilterToolbar
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          planCountByStatus={planCountByStatus}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          plansWithNoTasksCount={plansWithNoTasks.length}
          plansReadyToExecuteCount={
            autoExecutePlans
              ? plansEligibleForExecuteAllOrderedIds.length
              : plansReadyToExecute.length
          }
          planAllInProgress={planAllInProgress}
          executeAllInProgress={executeAllInProgress}
          executingPlanId={executingPlanId}
          planTasksPlanIds={planTasksPlanIds ?? []}
          onPlanAllTasks={handlePlanAllTasks}
          onExecuteAll={autoExecutePlans ? handleExecuteAllOrGenerateAndExecute : handleExecuteAll}
          autoExecutePlans={autoExecutePlans}
          onAddPlan={() => setAddPlanModalOpen(true)}
          searchExpanded={searchExpanded}
          searchInputValue={searchInputValue}
          setSearchInputValue={setSearchInputValue}
          searchInputRef={searchInputRef}
          handleSearchExpand={handleSearchExpand}
          handleSearchClose={handleSearchClose}
          handleSearchKeyDown={handleSearchKeyDown}
        />

        <div className={PHASE_MAIN_SCROLL_CLASSNAME} data-testid="plan-main-scroll">
          {/* Error banner — inline, dismissible */}
          {planError && (
            <div
              role="alert"
              className="mb-4 flex items-center justify-between gap-3 p-3 bg-theme-error-bg border border-theme-error-border rounded-lg"
              data-testid="plan-error-banner"
            >
              <span className="flex-1 min-w-0 text-sm text-theme-error-text">{planError}</span>
              <button
                type="button"
                onClick={() => dispatch(setPlanError(null))}
                className="shrink-0 p-1.5 rounded hover:bg-theme-error-border/50 text-theme-error-text hover:opacity-80 transition-colors"
                aria-label="Dismiss error"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {viewMode === "graph" ? (
            /* Graph Mode: dependency graph full screen */
            <div
              className="h-full min-h-[200px] sm:min-h-[320px] md:min-h-[400px] overflow-hidden"
              data-testid="plan-graph-view"
            >
              {filteredDependencyGraph && filteredDependencyGraph.plans.length === 0 ? (
                <div className="text-center py-10 text-theme-muted">
                  {isSearchActive
                    ? "No plans match your search."
                    : `No plans match the "${statusFilter === "all" ? "All" : statusFilter === "in_review" ? "In review" : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}" filter.`}
                </div>
              ) : (
                <DependencyGraph
                  graph={filteredDependencyGraph}
                  onPlanClick={handleSelectPlan}
                  fillHeight
                />
              )}
            </div>
          ) : (
            /* Card Mode: plan list */
            <>
              {showPlansEmptyState ? (
                <PhaseEmptyState
                  title={EMPTY_STATE_COPY.plan.title}
                  description={EMPTY_STATE_COPY.plan.description}
                  illustration={<PhaseEmptyStateLogo />}
                  primaryAction={{
                    label: EMPTY_STATE_COPY.plan.primaryActionLabel,
                    onClick: () => setAddPlanModalOpen(true),
                    "data-testid": "empty-state-new-plan",
                  }}
                />
              ) : filteredAndSortedPlans.length === 0 && optimisticPlans.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-theme-muted">
                    {isSearchActive
                      ? "No plans match your search."
                      : `No plans match the "${statusFilter === "all" ? "All" : statusFilter === "in_review" ? "In review" : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}" filter.`}
                  </p>
                </div>
              ) : (
                <PlanListView
                  plans={plansForListView}
                  selectedPlanId={selectedPlanId ?? null}
                  executingPlanId={executingPlanId}
                  reExecutingPlanId={reExecutingPlanId}
                  planTasksPlanIds={planTasksPlanIds ?? []}
                  executeError={executeError}
                  onSelectPlan={handleSelectPlan}
                  onShip={(planId, lastExecutedVersionNumber) => {
                    const plan = plansForListView.find((p) => p.metadata.planId === planId);
                    if (autoExecutePlans && plan) handleShipOrGenerateAndShip(plan);
                    else handleShip(planId, lastExecutedVersionNumber);
                  }}
                  onPlanTasks={handlePlanTasks}
                  onReship={handleReship}
                  onClearError={() => dispatch(clearExecuteError())}
                  onMarkComplete={(planId) => markPlanCompleteMutation.mutate(planId)}
                  markCompletePendingPlanId={
                    markPlanCompleteMutation.isPending
                      ? (markPlanCompleteMutation.variables ?? null)
                      : null
                  }
                  onGoToEvaluate={() => navigate(getProjectPhasePath(projectId, "eval"))}
                  autoExecutePlans={autoExecutePlans}
                />
              )}
            </>
          )}
        </div>
      </div>

      {addPlanModalOpen && (
        <AddPlanModal
          projectId={projectId}
          onGenerate={handleGeneratePlan}
          onClose={() => setAddPlanModalOpen(false)}
        />
      )}

      {crossEpicModal && (
        <CrossEpicConfirmModal
          planId={crossEpicModal.planId}
          prerequisitePlanIds={crossEpicModal.prerequisitePlanIds}
          onConfirm={handleCrossEpicConfirm}
          onCancel={() => setCrossEpicModal(null)}
          confirming={executingPlanId === crossEpicModal.planId}
        />
      )}

      {/* Delete plan confirmation */}
      {deleteConfirmPlanId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 w-full h-full bg-theme-overlay backdrop-blur-sm border-0 cursor-default"
            onClick={() => !deletingPlanId && setDeleteConfirmPlanId(null)}
            aria-label="Close"
          />
          <div className="relative bg-theme-surface rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
              <h2 className="text-lg font-semibold text-theme-text">Delete plan</h2>
              <CloseButton
                onClick={() => !deletingPlanId && setDeleteConfirmPlanId(null)}
                ariaLabel="Close delete confirmation"
              />
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-theme-text">Are you sure?</p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-theme-border bg-theme-bg rounded-b-xl">
              <button
                type="button"
                onClick={() => !deletingPlanId && setDeleteConfirmPlanId(null)}
                className="btn-secondary"
                disabled={!!deletingPlanId}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={!!deletingPlanId}
                className="btn-primary disabled:opacity-50"
              >
                {deletingPlanId ? "Deleting…" : "Yes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar: Plan Detail + Chat — show for plan or draft-plan chat contexts. */}
      {activePlanContext && (
        <ResizableSidebar
          storageKey="plan"
          defaultWidth={420}
          responsive={true}
          onClose={handleClosePlan}
        >
          {/* Sticky header + scrollable body (matches Execute sidebar) */}
          {selectedPlan ? (
            <PlanDetailContent
              key={selectedPlan.metadata.planId}
              plan={selectedPlan}
              onContentSave={handlePlanContentSave}
              saving={savingPlanContentId === selectedPlan.metadata.planId}
              projectId={projectId}
              planId={selectedPlan.metadata.planId}
              selectedVersionNumber={selectedVersionNumber}
              onVersionSelect={setSelectedVersionNumber}
              headerActions={
                <>
                  <div ref={planActionsMenuRef} className="relative shrink-0">
                    <button
                      ref={planActionsMenuTriggerRef}
                      type="button"
                      onClick={() => setPlanActionsMenuOpen((o) => !o)}
                      className="p-1.5 rounded-md text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors"
                      aria-label="Plan actions"
                      aria-haspopup="menu"
                      aria-expanded={planActionsMenuOpen}
                      data-testid="plan-sidebar-actions-menu-trigger"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                      </svg>
                    </button>
                    {planActionsMenuOpen && (
                      <ul
                        role="menu"
                        className={`dropdown-menu-elevated dropdown-menu-surface absolute top-full mt-1 min-w-[140px] ${planActionsMenuAlignRight ? "right-0 left-auto" : "left-0 right-auto"}`}
                        data-testid="plan-sidebar-actions-menu"
                      >
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              handleArchive(selectedPlan.metadata.planId);
                              setPlanActionsMenuOpen(false);
                            }}
                            disabled={!!archivingPlanId}
                            className="dropdown-item w-full flex items-center gap-2 text-left text-xs text-theme-text hover:bg-theme-border-subtle/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            data-testid="plan-sidebar-archive-btn"
                          >
                            {archivingPlanId ? "Archiving…" : "Archive"}
                          </button>
                        </li>
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setDeleteConfirmPlanId(selectedPlan.metadata.planId);
                              setPlanActionsMenuOpen(false);
                            }}
                            disabled={!!deletingPlanId}
                            className="dropdown-item w-full flex items-center gap-2 text-left text-xs text-theme-error-text hover:bg-theme-error-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            data-testid="plan-sidebar-delete-btn"
                          >
                            {deletingPlanId ? "Deleting…" : "Delete"}
                          </button>
                        </li>
                      </ul>
                    )}
                  </div>
                  <CloseButton onClick={handleClosePlan} ariaLabel="Close plan panel" />
                </>
              }
            >
              {({ header, body }) => (
                <>
                  <div className="shrink-0 bg-theme-bg">{header}</div>
                  <div
                    ref={sidebarScrollRef}
                    className="flex-1 overflow-y-auto min-h-0 flex flex-col"
                  >
                    {body}
                    {/* Mockups — collapsible (matches Execute sidebar section styling) */}
                    {selectedPlan.metadata.mockups && selectedPlan.metadata.mockups.length > 0 && (
                      <CollapsibleSection
                        title="Mockups"
                        expanded={mockupsSectionExpanded}
                        onToggle={() => setMockupsSectionExpanded((e) => !e)}
                        expandAriaLabel="Expand Mockups"
                        collapseAriaLabel="Collapse Mockups"
                        contentId="plan-mockups-content"
                        headerId="plan-mockups-header"
                        contentClassName="p-4 pt-0"
                      >
                        <div className="space-y-3">
                          {selectedPlan.metadata.mockups.map((mockup, i) => (
                            <div
                              key={i}
                              className="bg-theme-surface rounded-lg border overflow-hidden"
                            >
                              <div className="px-3 py-1.5 bg-theme-bg-elevated border-b">
                                <span className="text-xs font-medium text-theme-text">
                                  {mockup.title}
                                </span>
                              </div>
                              <pre className="p-3 text-xs leading-tight text-theme-text overflow-x-auto font-mono whitespace-pre">
                                {mockup.content}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </CollapsibleSection>
                    )}

                    {/* Tasks — collapsible (matches Execute sidebar section styling) */}
                    <CollapsibleSection
                      title={`Tasks (${selectedPlanTasks.length})`}
                      expanded={tasksSectionExpanded}
                      onToggle={() => setTasksSectionExpanded((e) => !e)}
                      expandAriaLabel="Expand Tasks"
                      collapseAriaLabel="Collapse Tasks"
                      contentId="plan-tasks-content"
                      headerId="plan-tasks-header"
                      contentClassName="px-4 pt-0"
                    >
                      <div className="space-y-2">
                        {selectedPlanTasks.length === 0 ? (
                          <div className="space-y-2">
                            {!autoExecutePlans && (
                              <p className="text-sm text-theme-muted">
                                Use the chat to refine the plan, then click Generate Tasks when
                                you&apos;re ready to break it down into specific tickets
                              </p>
                            )}
                            {autoExecutePlans ? (
                              <button
                                type="button"
                                onClick={() =>
                                  selectedPlan && handleShipOrGenerateAndShip(selectedPlan)
                                }
                                disabled={
                                  !!executingPlanId ||
                                  (planTasksPlanIds ?? []).includes(selectedPlan.metadata.planId)
                                }
                                className="btn-primary text-sm w-full py-2 rounded-lg font-medium inline-flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                                data-testid="execute-button-sidebar"
                              >
                                {(planTasksPlanIds ?? []).includes(selectedPlan.metadata.planId) ||
                                executingPlanId === selectedPlan.metadata.planId
                                  ? "Generating & executing…"
                                  : "Execute"}
                              </button>
                            ) : (planTasksPlanIds ?? []).includes(selectedPlan.metadata.planId) ? (
                              <p
                                className="text-sm text-theme-muted"
                                aria-busy="true"
                                aria-label="Planning tasks"
                                data-testid="plan-tasks-loading-sidebar"
                              >
                                Planning tasks…
                              </p>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handlePlanTasks(selectedPlan.metadata.planId)}
                                className="btn-primary text-sm w-full py-2 rounded-lg font-medium inline-flex items-center justify-center"
                                data-testid="plan-tasks-button-sidebar"
                              >
                                Generate Tasks
                              </button>
                            )}
                          </div>
                        ) : (
                          selectedPlanTasks.map((task) => (
                            <button
                              key={task.id}
                              type="button"
                              onClick={() => onNavigateToBuildTask?.(task.id)}
                              className="w-full flex items-center gap-2 p-2 bg-theme-surface rounded-lg border border-theme-border text-sm text-left hover:border-theme-info-border hover:bg-theme-info-bg/50 transition-colors cursor-pointer"
                            >
                              <span
                                className={`shrink-0 w-2 h-2 rounded-full ${
                                  task.kanbanColumn === "done"
                                    ? "bg-theme-success-solid"
                                    : task.kanbanColumn === "in_progress" ||
                                        task.kanbanColumn === "in_review"
                                      ? "bg-theme-info-solid"
                                      : "bg-theme-ring"
                                }`}
                                title={task.kanbanColumn}
                              />
                              <span className="flex-1 truncate text-theme-text" title={task.title}>
                                {task.title}
                              </span>
                              <span className="shrink-0 text-xs text-theme-muted capitalize">
                                {task.kanbanColumn.replace(/_/g, " ")}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </CollapsibleSection>

                    {/* Auditor live output — when Re-execute is running */}
                    {reExecutingPlanId === selectedPlan.metadata.planId && (
                      <PlanAuditorOutputSection
                        planId={selectedPlan.metadata.planId}
                        auditorOutput={auditorOutputByPlanId[selectedPlan.metadata.planId] ?? ""}
                        wsConnected={wsConnected}
                        activeAuditor={activeAgents.find(
                          (a) => a.role === "auditor" && a.planId === selectedPlan.metadata.planId
                        )}
                        onRetryConnect={() => dispatch(wsConnect({ projectId }))}
                      />
                    )}

                    {/* Auditor runs — historical execution logs; hide when selected version is still in Planning */}
                    {(() => {
                      const effectiveVersion =
                        selectedVersionNumber ?? selectedPlan.currentVersionNumber ?? 1;
                      const lastExec = selectedPlan.lastExecutedVersionNumber;
                      const showAuditorRuns = lastExec != null && effectiveVersion <= lastExec;
                      return showAuditorRuns ? (
                        <AuditorRunsSection
                          projectId={projectId}
                          planId={selectedPlan.metadata.planId}
                        />
                      ) : null;
                    })()}

                    {/* Open questions block — when planner needs clarification */}
                    {sidebarOpenQuestionNotification && (
                      <OpenQuestionsBlock
                        notification={sidebarOpenQuestionNotification}
                        projectId={projectId}
                        source="plan"
                        sourceId={sidebarOpenQuestionNotification.sourceId}
                        onResolved={refetchNotifications}
                        onAnswerSent={async (message) => {
                          const result = await dispatch(
                            sendPlanMessage({
                              projectId,
                              message,
                              context: activePlanContext,
                            })
                          );
                          if (sendPlanMessage.fulfilled.match(result)) {
                            void queryClient.invalidateQueries({
                              queryKey: queryKeys.plans.list(projectId),
                            });
                            if (selectedPlanId) {
                              void queryClient.invalidateQueries({
                                queryKey: queryKeys.plans.detail(projectId, selectedPlanId!),
                              });
                            }
                            if (result.payload.response.planGenerated?.planId) {
                              const generatedPlanId = result.payload.response.planGenerated.planId;
                              setSelectedDraftPlanId(null);
                              dispatch(setSelectedPlanId(generatedPlanId));
                              onSelectPlanId?.(generatedPlanId);
                            }
                            void planChatQuery.refetch();
                          } else {
                            throw new Error(result.error?.message ?? "Failed to send");
                          }
                        }}
                      />
                    )}

                    {/* Refine with AI — collapsible (matches Execute sidebar section styling) */}
                    <CollapsibleSection
                      title="Refine with AI"
                      expanded={refineSectionExpanded}
                      onToggle={() => setRefineSectionExpanded((e) => !e)}
                      expandAriaLabel="Expand Refine with AI"
                      collapseAriaLabel="Collapse Refine with AI"
                      contentId="plan-refine-content"
                      headerId="plan-refine-header"
                      contentClassName="p-4 pt-0"
                    >
                      <div
                        className="space-y-3"
                        data-testid="plan-chat-messages"
                        {...(sidebarOpenQuestionNotification && {
                          "data-question-id": sidebarOpenQuestionNotification.id,
                        })}
                      >
                        {currentChatMessages.length === 0 && (
                          <p className="text-sm text-theme-muted">
                            Chat with the planning agent to refine this plan. Ask questions, suggest
                            changes, or request updates.
                          </p>
                        )}
                        {currentChatMessages.map((msg, i) => (
                          <div
                            key={`${msg.role}-${i}-${msg.timestamp}`}
                            data-testid={`plan-chat-message-${msg.role}`}
                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                                msg.role === "user"
                                  ? "border border-theme-border bg-theme-surface text-theme-text shadow-sm"
                                  : "bg-theme-surface border border-theme-border text-theme-text"
                              }`}
                            >
                              <p className="whitespace-pre-wrap">
                                {getPlanChatMessageDisplay(msg.content)}
                              </p>
                            </div>
                          </div>
                        ))}
                        {chatSending && (
                          <div className="flex justify-start">
                            <div className="bg-theme-surface border border-theme-border rounded-2xl px-3 py-2 text-sm text-theme-muted">
                              Thinking...
                            </div>
                          </div>
                        )}
                        <div ref={messagesEndRef} />
                      </div>
                    </CollapsibleSection>
                  </div>
                </>
              )}
            </PlanDetailContent>
          ) : (
            <>
              <div className="shrink-0 bg-theme-bg p-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-theme-text truncate">
                  {selectedPlanId
                    ? formatPlanIdAsTitle(selectedPlanId)
                    : effectiveDraftPlanId
                      ? "Draft Plan"
                      : "Plan"}
                </h3>
                <CloseButton onClick={handleClosePlan} ariaLabel="Close plan panel" />
              </div>
              <div ref={sidebarScrollRef} className="flex-1 overflow-y-auto min-h-0 flex flex-col">
                <div className="p-4 text-sm text-theme-muted">Loading plan...</div>
                {sidebarOpenQuestionNotification && (
                  <OpenQuestionsBlock
                    notification={sidebarOpenQuestionNotification}
                    projectId={projectId}
                    source="plan"
                    sourceId={sidebarOpenQuestionNotification.sourceId}
                    onResolved={refetchNotifications}
                    onAnswerSent={async (message) => {
                      const result = await dispatch(
                        sendPlanMessage({
                          projectId,
                          message,
                          context: activePlanContext,
                        })
                      );
                      if (!sendPlanMessage.fulfilled.match(result)) {
                        throw new Error(result.error?.message ?? "Failed to send");
                      }
                      if (result.payload.response.planGenerated?.planId) {
                        const planId = result.payload.response.planGenerated.planId;
                        setSelectedDraftPlanId(null);
                        dispatch(setSelectedPlanId(planId));
                        onSelectPlanId?.(planId);
                        void queryClient.invalidateQueries({
                          queryKey: queryKeys.plans.list(projectId),
                        });
                        void queryClient.invalidateQueries({
                          queryKey: queryKeys.plans.detail(projectId, planId),
                        });
                      }
                      void planChatQuery.refetch();
                    }}
                  />
                )}
                <CollapsibleSection
                  title="Refine with AI"
                  expanded={refineSectionExpanded}
                  onToggle={() => setRefineSectionExpanded((e) => !e)}
                  expandAriaLabel="Expand Refine with AI"
                  collapseAriaLabel="Collapse Refine with AI"
                  contentId="plan-refine-content"
                  headerId="plan-refine-header"
                  contentClassName="p-4 pt-0"
                >
                  <div
                    className="space-y-3"
                    data-testid="plan-chat-messages"
                    {...(sidebarOpenQuestionNotification && {
                      "data-question-id": sidebarOpenQuestionNotification.id,
                    })}
                  >
                    {currentChatMessages.length === 0 && (
                      <p className="text-sm text-theme-muted">
                        Chat with the planning agent to refine this plan. Ask questions, suggest
                        changes, or request updates.
                      </p>
                    )}
                    {currentChatMessages.map((msg, i) => (
                      <div
                        key={`${msg.role}-${i}-${msg.timestamp}`}
                        data-testid={`plan-chat-message-${msg.role}`}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                            msg.role === "user"
                              ? "border border-theme-border bg-theme-surface text-theme-text shadow-sm"
                              : "bg-theme-surface border border-theme-border text-theme-text"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">
                            {getPlanChatMessageDisplay(msg.content)}
                          </p>
                        </div>
                      </div>
                    ))}
                    {chatSending && (
                      <div className="flex justify-start">
                        <div className="bg-theme-surface border border-theme-border rounded-2xl px-3 py-2 text-sm text-theme-muted">
                          Thinking...
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </CollapsibleSection>
              </div>
            </>
          )}

          {/* Pinned chat input at bottom (no divider — matches Execute sidebar) */}
          <div className="shrink-0 p-4 bg-theme-bg">
            <ChatInput
              value={chatInput}
              onChange={setChatInput}
              onSend={handleSendChat}
              sendDisabled={chatSending}
              placeholder="Refine this plan..."
              aria-label="Refine this plan"
            />
          </div>
        </ResizableSidebar>
      )}
    </div>
  );
}
