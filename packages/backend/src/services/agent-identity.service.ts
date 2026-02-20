/**
 * Agent identity and performance tracking service.
 *
 * Records task attempt outcomes and uses that history to make smarter retry
 * decisions — including model escalation when the same failure type repeats.
 * Stats are persisted to `.opensprint/agent-stats.json`.
 */

import fs from "fs/promises";
import path from "path";
import type { AgentConfig, ProjectSettings } from "@opensprint/shared";
import { OPENSPRINT_PATHS, getCodingAgentForComplexity } from "@opensprint/shared";
import type { PlanComplexity } from "@opensprint/shared";
import { writeJsonAtomic } from "../utils/file-utils.js";

export type AttemptOutcome =
  | "success"
  | "test_failure"
  | "review_rejection"
  | "crash"
  | "timeout"
  | "no_result"
  | "coding_failure";

export interface TaskAttemptRecord {
  taskId: string;
  agentId: string;
  model: string;
  attempt: number;
  startedAt: string;
  completedAt: string;
  outcome: AttemptOutcome;
  durationMs: number;
}

export interface AgentProfile {
  id: string;
  model: string;
  stats: {
    tasksAttempted: number;
    tasksSucceeded: number;
    tasksFailed: number;
    avgTimeToComplete: number;
    failuresByType: Record<string, number>;
  };
}

interface PersistedAgentStats {
  attempts: TaskAttemptRecord[];
}

/** Known model escalation ladder (from faster/cheaper to more capable) */
const MODEL_ESCALATION: string[] = ["claude-sonnet-4-20250514", "claude-opus-4-20250514"];

export class AgentIdentityService {
  private statsCache = new Map<string, PersistedAgentStats>();

  async recordAttempt(repoPath: string, record: TaskAttemptRecord): Promise<void> {
    const stats = await this.loadStats(repoPath);
    stats.attempts.push(record);

    // Keep only the last 500 records to prevent unbounded growth
    if (stats.attempts.length > 500) {
      stats.attempts = stats.attempts.slice(-500);
    }

    await this.saveStats(repoPath, stats);
  }

  async getProfile(repoPath: string, agentId: string): Promise<AgentProfile> {
    const stats = await this.loadStats(repoPath);
    const records = stats.attempts.filter((a) => a.agentId === agentId);

    const succeeded = records.filter((r) => r.outcome === "success");
    const failed = records.filter((r) => r.outcome !== "success");
    const failuresByType: Record<string, number> = {};
    for (const r of failed) {
      failuresByType[r.outcome] = (failuresByType[r.outcome] || 0) + 1;
    }

    const totalDuration = succeeded.reduce((sum, r) => sum + r.durationMs, 0);

    return {
      id: agentId,
      model: records.at(-1)?.model ?? "unknown",
      stats: {
        tasksAttempted: records.length,
        tasksSucceeded: succeeded.length,
        tasksFailed: failed.length,
        avgTimeToComplete: succeeded.length > 0 ? totalDuration / succeeded.length : 0,
        failuresByType,
      },
    };
  }

  /**
   * Select the best agent config for a retry attempt.
   * Escalates to a more capable model when the same failure type repeats.
   */
  selectAgentForRetry(
    settings: ProjectSettings,
    taskId: string,
    attempt: number,
    failureType: string,
    complexity: PlanComplexity | undefined,
    recentAttempts: TaskAttemptRecord[]
  ): AgentConfig {
    const baseConfig = getCodingAgentForComplexity(settings, complexity);

    // Attempt 1-2: use the configured model
    if (attempt <= 2) return baseConfig;

    // Count consecutive same-type failures for this task
    const taskAttempts = recentAttempts
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => a.attempt - b.attempt);

    const consecutiveSameType = taskAttempts
      .slice()
      .reverse()
      .findIndex((a) => a.outcome !== failureType);
    const sameTypeCount = consecutiveSameType === -1 ? taskAttempts.length : consecutiveSameType;

    // 3+ consecutive failures of the same type: escalate model
    if (sameTypeCount >= 2 && baseConfig.model) {
      const escalated = this.escalateModel(baseConfig.model);
      if (escalated && escalated !== baseConfig.model) {
        console.log(
          `[agent-identity] Escalating model for ${taskId}: ${baseConfig.model} → ${escalated} ` +
            `(${sameTypeCount} consecutive ${failureType} failures)`
        );
        return { ...baseConfig, model: escalated };
      }
    }

    return baseConfig;
  }

  async getRecentAttempts(repoPath: string, taskId: string): Promise<TaskAttemptRecord[]> {
    const stats = await this.loadStats(repoPath);
    return stats.attempts.filter((a) => a.taskId === taskId);
  }

  private escalateModel(currentModel: string): string | null {
    const idx = MODEL_ESCALATION.findIndex((m) => currentModel.includes(m.split("-")[1]!));
    if (idx >= 0 && idx < MODEL_ESCALATION.length - 1) {
      return MODEL_ESCALATION[idx + 1]!;
    }
    // If model not in ladder or already at max, return the last (most capable)
    if (idx === -1) return MODEL_ESCALATION.at(-1) ?? null;
    return null;
  }

  private async loadStats(repoPath: string): Promise<PersistedAgentStats> {
    const cached = this.statsCache.get(repoPath);
    if (cached) return cached;

    const statsPath = path.join(repoPath, OPENSPRINT_PATHS.agentStats);
    try {
      const raw = await fs.readFile(statsPath, "utf-8");
      const data = JSON.parse(raw) as PersistedAgentStats;
      this.statsCache.set(repoPath, data);
      return data;
    } catch {
      const empty: PersistedAgentStats = { attempts: [] };
      this.statsCache.set(repoPath, empty);
      return empty;
    }
  }

  private async saveStats(repoPath: string, stats: PersistedAgentStats): Promise<void> {
    this.statsCache.set(repoPath, stats);
    const statsPath = path.join(repoPath, OPENSPRINT_PATHS.agentStats);
    try {
      await fs.mkdir(path.dirname(statsPath), { recursive: true });
      await writeJsonAtomic(statsPath, stats);
    } catch (err) {
      console.warn("[agent-identity] Failed to persist agent stats:", err);
    }
  }
}

export const agentIdentityService = new AgentIdentityService();
