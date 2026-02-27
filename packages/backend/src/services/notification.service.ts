/**
 * NotificationService — manages open questions (agent clarification requests).
 * Persisted in ~/.opensprint/tasks.db (open_questions table).
 */

import crypto from "crypto";
import { taskStore } from "./task-store.service.js";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("notification");

export type NotificationSource = "plan" | "prd" | "execute" | "eval";

export interface OpenQuestionItem {
  id: string;
  text: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  projectId: string;
  source: NotificationSource;
  sourceId: string;
  questions: OpenQuestionItem[];
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
}

export interface CreateNotificationInput {
  projectId: string;
  source: NotificationSource;
  sourceId: string;
  questions: Array<{ id: string; text: string; createdAt?: string }>;
}

function generateId(): string {
  return "oq-" + crypto.randomBytes(4).toString("hex");
}

function rowToNotification(row: Record<string, unknown>): Notification {
  const questions: OpenQuestionItem[] = JSON.parse((row.questions as string) || "[]");
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    source: row.source as NotificationSource,
    sourceId: row.source_id as string,
    questions,
    status: (row.status as "open" | "resolved") || "open",
    createdAt: row.created_at as string,
    resolvedAt: (row.resolved_at as string) ?? null,
  };
}

export class NotificationService {
  /**
   * Create a new notification (open question) for an agent clarification request.
   */
  async create(input: CreateNotificationInput): Promise<Notification> {
    const id = generateId();
    const createdAt = new Date().toISOString();
    const questions: OpenQuestionItem[] = input.questions.map((q) => ({
      id: q.id,
      text: q.text,
      createdAt: q.createdAt ?? createdAt,
    }));

    await taskStore.runWrite(async (db) => {
      db.run(
        `INSERT INTO open_questions (id, project_id, source, source_id, questions, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`,
        [
          id,
          input.projectId,
          input.source,
          input.sourceId,
          JSON.stringify(questions),
          createdAt,
        ]
      );
    });

    log.info("Created notification", {
      id,
      projectId: input.projectId,
      source: input.source,
      sourceId: input.sourceId,
      questionCount: questions.length,
    });

    return {
      id,
      projectId: input.projectId,
      source: input.source,
      sourceId: input.sourceId,
      questions,
      status: "open",
      createdAt,
      resolvedAt: null,
    };
  }

  /**
   * List unresolved notifications for a project.
   */
  async listByProject(projectId: string): Promise<Notification[]> {
    const db = await taskStore.getDb();
    const stmt = db.prepare(
      "SELECT * FROM open_questions WHERE project_id = ? AND status = 'open' ORDER BY created_at DESC"
    );
    stmt.bind([projectId]);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, unknown>);
    }
    stmt.free();
    return rows.map(rowToNotification);
  }

  /**
   * List unresolved notifications across all projects (global).
   */
  async listGlobal(): Promise<Notification[]> {
    const db = await taskStore.getDb();
    const stmt = db.prepare(
      "SELECT * FROM open_questions WHERE status = 'open' ORDER BY created_at DESC"
    );
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, unknown>);
    }
    stmt.free();
    return rows.map(rowToNotification);
  }

  /**
   * Resolve a notification by ID. Project ID is required for scoping.
   */
  async resolve(projectId: string, notificationId: string): Promise<Notification> {
    const db = await taskStore.getDb();
    const stmt = db.prepare(
      "SELECT * FROM open_questions WHERE id = ? AND project_id = ?"
    );
    stmt.bind([notificationId, projectId]);
    const row = stmt.step() ? (stmt.getAsObject() as Record<string, unknown>) : null;
    stmt.free();

    if (!row) {
      throw new AppError(
        404,
        ErrorCodes.NOTIFICATION_NOT_FOUND,
        `Notification '${notificationId}' not found`,
        { notificationId, projectId }
      );
    }

    const resolvedAt = new Date().toISOString();

    await taskStore.runWrite(async (db) => {
      db.run(
        "UPDATE open_questions SET status = 'resolved', resolved_at = ? WHERE id = ? AND project_id = ?",
        [resolvedAt, notificationId, projectId]
      );
    });

    log.info("Resolved notification", { notificationId, projectId });

    const notification = rowToNotification(row);
    return {
      ...notification,
      status: "resolved",
      resolvedAt,
    };
  }
}

export const notificationService = new NotificationService();
