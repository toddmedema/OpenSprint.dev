/**
 * Background preload of phase data and chunks so the first navigation to each
 * phase tab shows content immediately. Does not block initial load or current tab.
 * Failed preloads are ignored; tabs still load on demand on first click.
 */

import type { QueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryKeys } from "../api/queryKeys";
import { parsePrdSections } from "./prdUtils";

const SKETCH_CONTEXT = "sketch";

/**
 * Prefetches TanStack Query data for Plan, Execute, Evaluate, and Deliver phases
 * so the first click on each tab finds cache populated. Each prefetch is wrapped
 * in try/catch so a failed preload does not break the tab (it will load on demand).
 */
export function preloadPhaseData(projectId: string, queryClient: QueryClient): void {
  const prefetches: Array<{ queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }> = [
    {
      queryKey: queryKeys.execute.status(projectId),
      queryFn: () => api.execute.status(projectId),
    },
    {
      queryKey: queryKeys.deliver.status(projectId),
      queryFn: () => api.deliver.status(projectId),
    },
    {
      queryKey: queryKeys.deliver.history(projectId),
      queryFn: () => api.deliver.history(projectId, undefined),
    },
    {
      queryKey: queryKeys.prd.detail(projectId),
      queryFn: async () => parsePrdSections(await api.prd.get(projectId)),
    },
    {
      queryKey: queryKeys.prd.history(projectId),
      queryFn: () => api.prd.getHistory(projectId),
    },
    {
      queryKey: queryKeys.chat.history(projectId, SKETCH_CONTEXT),
      queryFn: async () => {
        const conv = await api.chat.history(projectId, SKETCH_CONTEXT);
        return conv?.messages ?? [];
      },
    },
    {
      queryKey: queryKeys.plans.status(projectId),
      queryFn: () => api.projects.getPlanStatus(projectId),
    },
    {
      queryKey: queryKeys.feedback.list(projectId),
      queryFn: () => api.feedback.list(projectId),
    },
  ];

  for (const { queryKey, queryFn } of prefetches) {
    void queryClient.prefetchQuery({ queryKey, queryFn }).catch(() => {
      // Ignore: tab will load on demand on first click.
    });
  }
}

/**
 * Preloads the lazy phase component chunks (Sketch, Plan, Execute, Eval, Deliver)
 * so the first navigation to each tab does not show a loading spinner. Errors are
 * ignored; the tab will still load the chunk on first click.
 */
export function preloadPhaseChunks(): void {
  const chunks = [
    () => import("../pages/phases/SketchPhase"),
    () => import("../pages/phases/PlanPhase"),
    () => import("../pages/phases/ExecutePhase"),
    () => import("../pages/phases/EvalPhase"),
    () => import("../pages/phases/DeliverPhase"),
  ];
  for (const load of chunks) {
    void load().catch(() => {
      // Ignore: tab will load chunk on first click.
    });
  }
}

/**
 * Schedules background preload after the current view is idle so it does not
 * degrade initial page load or current tab responsiveness.
 */
export function schedulePhasePreload(projectId: string, queryClient: QueryClient): void {
  const run = () => {
    preloadPhaseData(projectId, queryClient);
    preloadPhaseChunks();
  };

  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(() => run(), { timeout: 2000 });
  } else {
    setTimeout(run, 100);
  }
}
