import type { BeadsService, BeadsIssue } from "./beads.service.js";
import type { AgentSlot } from "./orchestrator.service.js";
import { FileScopeAnalyzer, type FileScope } from "./file-scope-analyzer.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("task-scheduler");

export interface SchedulerResult {
  task: BeadsIssue;
  fileScope: FileScope;
}

/**
 * Selects tasks for parallel execution based on priority and file-overlap detection.
 * When maxConcurrentCoders > 1, uses FileScopeAnalyzer to avoid dispatching
 * tasks that modify overlapping files.
 */
export class TaskScheduler {
  private analyzer = new FileScopeAnalyzer();

  constructor(private beads: BeadsService) {}

  /**
   * Select up to (maxSlots - activeSlots.size) tasks from readyTasks.
   * Filters out plan approval gates, epics, blocked tasks, and tasks already in a slot.
   * Performs blocker pre-flight check and file-overlap detection.
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

    // Collect active slot scopes for overlap detection
    const activeScopes: FileScope[] = [];
    for (const slot of activeSlots.values()) {
      if ((slot as any).fileScope) {
        activeScopes.push((slot as any).fileScope);
      }
    }

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

      // File-overlap detection (only when parallel dispatch is active)
      if (maxSlots > 1 && (activeScopes.length > 0 || results.length > 0)) {
        const scope = await this.analyzer.predict(repoPath, task, this.beads);

        const overlapping = [...activeScopes, ...results.map((r) => r.fileScope)].some((s) =>
          this.analyzer.overlaps(scope, s)
        );

        if (overlapping) {
          log.info("Skipping task (file scope overlaps with active/selected)", {
            taskId: task.id,
            confidence: scope.confidence,
          });
          continue;
        }

        results.push({ task, fileScope: scope });
        continue;
      }

      // Single-dispatch or first task: no overlap check needed
      const scope = await this.analyzer.predict(repoPath, task, this.beads);
      results.push({ task, fileScope: scope });
    }

    return results;
  }
}
