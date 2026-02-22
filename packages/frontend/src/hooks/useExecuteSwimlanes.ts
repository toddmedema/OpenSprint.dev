import { useMemo } from "react";
import type { Task } from "@opensprint/shared";
import { sortEpicTasksByStatus } from "../lib/executeTaskSort";
import {
  filterTasksByStatusAndSearch,
  type StatusFilter,
} from "../lib/executeTaskFilter";
import { getEpicTitleFromPlan } from "../lib/planContentUtils";
import type { Plan } from "@opensprint/shared";

export interface Swimlane {
  epicId: string;
  epicTitle: string;
  planId: string | null;
  tasks: Task[];
}

export function useExecuteSwimlanes(
  tasks: Task[],
  plans: Plan[],
  statusFilter: StatusFilter,
  searchQuery: string
) {
  const implTasks = useMemo(
    () =>
      tasks.filter((t) => {
        const isEpic = t.type === "epic";
        const isGating = /\.0$/.test(t.id);
        return !isEpic && !isGating;
      }),
    [tasks],
  );

  const filteredTasks = useMemo(
    () => filterTasksByStatusAndSearch(implTasks, statusFilter, searchQuery),
    [implTasks, statusFilter, searchQuery],
  );

  const swimlanes = useMemo((): Swimlane[] => {
    const epicIdToTitle = new Map<string, string>();
    const epicIdToPlanId = new Map<string, string>();
    plans.forEach((p) => {
      epicIdToTitle.set(p.metadata.beadEpicId, getEpicTitleFromPlan(p));
      epicIdToPlanId.set(p.metadata.beadEpicId, p.metadata.planId);
    });

    const byEpic = new Map<string | null, Task[]>();
    for (const t of filteredTasks) {
      const key = t.epicId ?? null;
      if (!byEpic.has(key)) byEpic.set(key, []);
      byEpic.get(key)!.push(t);
    }

    const allDone = (ts: Task[]) =>
      ts.length > 0 && ts.every((t) => t.kanbanColumn === "done");
    const hideCompletedEpics = statusFilter === "all";

    const includeLane = (laneTasks: Task[]) =>
      laneTasks.length > 0 && (!hideCompletedEpics || !allDone(laneTasks));

    const result: Swimlane[] = [];
    for (const plan of plans) {
      const epicId = plan.metadata.beadEpicId;
      if (!epicId) continue;
      const laneTasks = byEpic.get(epicId) ?? [];
      if (includeLane(laneTasks)) {
        result.push({
          epicId,
          epicTitle: epicIdToTitle.get(epicId) ?? epicId,
          planId: epicIdToPlanId.get(epicId) ?? null,
          tasks: sortEpicTasksByStatus(laneTasks),
        });
      }
    }
    const seenEpics = new Set(result.map((r) => r.epicId));
    for (const [epicId, laneTasks] of byEpic) {
      if (epicId && !seenEpics.has(epicId) && includeLane(laneTasks)) {
        result.push({
          epicId,
          epicTitle: epicId,
          planId: epicIdToPlanId.get(epicId) ?? null,
          tasks: sortEpicTasksByStatus(laneTasks),
        });
        seenEpics.add(epicId);
      }
    }
    const unassigned = byEpic.get(null) ?? [];
    if (includeLane(unassigned)) {
      result.push({ epicId: "", epicTitle: "Other", planId: null, tasks: sortEpicTasksByStatus(unassigned) });
    }
    return result;
  }, [filteredTasks, plans, statusFilter]);

  const totalTasks = implTasks.length;
  const readyCount = implTasks.filter((t) => t.kanbanColumn === "ready").length;
  const blockedOnHumanCount = implTasks.filter((t) => t.kanbanColumn === "blocked").length;
  const inProgressCount = implTasks.filter((t) => t.kanbanColumn === "in_progress").length;
  const inReviewCount = implTasks.filter((t) => t.kanbanColumn === "in_review").length;
  const doneCount = implTasks.filter((t) => t.kanbanColumn === "done").length;

  const chipConfig: { label: string; filter: StatusFilter; count: number }[] = [
    { label: "All", filter: "all", count: totalTasks },
    { label: "Ready", filter: "ready", count: readyCount },
    { label: "In Progress", filter: "in_progress", count: inProgressCount },
    { label: "In Review", filter: "in_review", count: inReviewCount },
    { label: "Done", filter: "done", count: doneCount },
    ...(blockedOnHumanCount > 0
      ? [{ label: "⚠️ Blocked on Human", filter: "blocked" as StatusFilter, count: blockedOnHumanCount }]
      : []),
  ];

  return { implTasks, swimlanes, chipConfig };
}
