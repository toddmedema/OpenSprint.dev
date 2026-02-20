/**
 * Persistent event log for orchestrator operations (append-only JSONL).
 *
 * Provides an audit trail for debugging multi-attempt failures and richer
 * crash recovery intelligence. Events are appended to `.opensprint/events.jsonl`.
 */

import fs from "fs/promises";
import path from "path";
import { OPENSPRINT_PATHS } from "@opensprint/shared";
import { createLogger } from "../utils/logger.js";

const log = createLogger("event-log");

export interface OrchestratorEvent {
  timestamp: string;
  projectId: string;
  taskId: string;
  event: string;
  data?: Record<string, unknown>;
}

export class EventLogService {
  private getLogPath(repoPath: string): string {
    return path.join(repoPath, OPENSPRINT_PATHS.eventsLog);
  }

  async append(repoPath: string, event: OrchestratorEvent): Promise<void> {
    const logPath = this.getLogPath(repoPath);
    try {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, JSON.stringify(event) + "\n", "utf-8");
    } catch (err) {
      log.warn("Failed to append event", { err });
    }
  }

  async readSince(repoPath: string, since: string): Promise<OrchestratorEvent[]> {
    const sinceTime = new Date(since).getTime();
    const events = await this.readAll(repoPath);
    return events.filter((e) => new Date(e.timestamp).getTime() >= sinceTime);
  }

  async readForTask(repoPath: string, taskId: string): Promise<OrchestratorEvent[]> {
    const events = await this.readAll(repoPath);
    return events.filter((e) => e.taskId === taskId);
  }

  /**
   * Read the last N events (useful for crash recovery context).
   */
  async readRecent(repoPath: string, count = 50): Promise<OrchestratorEvent[]> {
    const events = await this.readAll(repoPath);
    return events.slice(-count);
  }

  private async readAll(repoPath: string): Promise<OrchestratorEvent[]> {
    const logPath = this.getLogPath(repoPath);
    try {
      const raw = await fs.readFile(logPath, "utf-8");
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as OrchestratorEvent;
          } catch {
            return null;
          }
        })
        .filter((e): e is OrchestratorEvent => e !== null);
    } catch {
      return [];
    }
  }
}

export const eventLogService = new EventLogService();
