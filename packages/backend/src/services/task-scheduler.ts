import type { BeadsService, BeadsIssue } from "./beads.service.js";
import type { AgentSlot } from "./orchestrator.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("task-scheduler");

export interface SchedulerResult {
  task: BeadsIssue;
}

/**
 * Selects tasks for parallel execution based on priority and (in Phase 3) file-overlap.
 * Phase 1: picks top-priority tasks from the ready queue.
 * Phase 3: adds FileScopeAnalyzer overlap detection.
 */
export class TaskScheduler {
  constructor(private beads: BeadsService) {}

  /**
   * Select up to (maxSlots - activeSlots.size) tasks from readyTasks.
   * Filters out plan approval gates, epics, blocked tasks, and tasks already in a slot.
   * Performs blocker pre-flight check for each candidate.
   */
  async selectTasks(
    repoPath: string,
    readyTasks: BeadsIssue[],
    activeSlots: Map<string, AgentSlot>,
    maxSlots: number,
  ): Promise<SchedulerResult[]> {
    const slotsAvailable = maxSlots - activeSlots.size;
    if (slotsAvailable <= 0) return [];

    let candidates = readyTasks
      .filter((t) => (t.title ?? "") !== "Plan approval gate")
      .filter((t) => (t.issue_type ?? t.type) !== "epic")
      .filter((t) => (t.status as string) !== "blocked")
      .filter((t) => !activeSlots.has(t.id));

    const statusMap = await this.beads.getStatusMap(repoPath);

    const results: SchedulerResult[] = [];
    for (const task of candidates) {
      if (results.length >= slotsAvailable) break;

      const allClosed = await this.beads.areAllBlockersClosed(repoPath, task.id, statusMap);
      if (!allClosed) {
        log.info("Skipping task (blockers not all closed)", {
          taskId: task.id,
          title: task.title,
        });
        continue;
      }

      results.push({ task });
    }

    return results;
  }
}
