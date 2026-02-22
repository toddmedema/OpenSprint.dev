import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import type { BeadsIssue } from "./beads.service.js";
import { invalidateJsonlCache } from "./jsonl-reader.js";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("jsonl-store");

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 4;

interface RepoState {
  issues: Map<string, BeadsIssue>;
  filePath: string;
  prefix: string;
  mutex: Promise<unknown>;
}

const repoStates = new Map<string, RepoState>();
const pendingLoads = new Map<string, Promise<RepoState>>();

function resolveKey(repoPath: string): string {
  return path.resolve(repoPath);
}

function jsonlFilePath(repoPath: string): string {
  return path.join(repoPath, ".beads/issues.jsonl");
}

function generateBase36(length: number): string {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += BASE36[bytes[i]! % 36];
  }
  return result;
}

function parseJsonlContent(content: string): Map<string, BeadsIssue> {
  const byId = new Map<string, BeadsIssue>();
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const issue = JSON.parse(trimmed) as BeadsIssue;
      if (issue.id) byId.set(issue.id, issue);
    } catch {
      // skip malformed lines
    }
  }
  return byId;
}

/**
 * Detect the beads project prefix from .beads/config.yaml or existing issues.
 * Falls back to the directory basename.
 */
async function detectPrefix(repoPath: string): Promise<string> {
  // Try to read from config.yaml
  try {
    const configPath = path.join(repoPath, ".beads/config.yaml");
    const content = await fs.readFile(configPath, "utf-8");
    const match = content.match(/^issue-prefix:\s*"?([^"\n]+)"?\s*$/m);
    if (match?.[1]?.trim()) return match[1].trim();
  } catch {
    // no config or unreadable
  }

  // Infer from existing issue IDs
  const filePath = jsonlFilePath(repoPath);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const firstLine = content.split("\n").find((l) => l.trim());
    if (firstLine) {
      const issue = JSON.parse(firstLine) as { id?: string };
      if (issue.id) {
        const dashIdx = issue.id.lastIndexOf("-");
        if (dashIdx > 0) return issue.id.slice(0, dashIdx);
      }
    }
  } catch {
    // no issues yet
  }

  return path.basename(repoPath);
}

async function loadState(repoPath: string): Promise<RepoState> {
  const key = resolveKey(repoPath);
  const existing = repoStates.get(key);
  if (existing) return existing;

  const pending = pendingLoads.get(key);
  if (pending) return pending;

  const loadPromise = (async () => {
    const filePath = jsonlFilePath(repoPath);
    let issues = new Map<string, BeadsIssue>();
    try {
      const content = await fs.readFile(filePath, "utf-8");
      issues = parseJsonlContent(content);
    } catch {
      // file doesn't exist yet
    }

    const prefix = await detectPrefix(repoPath);
    const state: RepoState = { issues, filePath, prefix, mutex: Promise.resolve() };
    repoStates.set(key, state);
    pendingLoads.delete(key);
    return state;
  })();

  pendingLoads.set(key, loadPromise);
  return loadPromise;
}

/**
 * Reload from disk if an external process (agent bd CLI) modified the JSONL.
 * Compares our in-memory set against the file mtime.
 */
async function refreshIfStale(state: RepoState): Promise<void> {
  try {
    const content = await fs.readFile(state.filePath, "utf-8");
    state.issues = parseJsonlContent(content);
  } catch {
    // file gone or unreadable — keep in-memory state
  }
}

async function flushToDisk(state: RepoState): Promise<void> {
  const lines: string[] = [];
  for (const issue of state.issues.values()) {
    lines.push(JSON.stringify(issue));
  }
  const content = lines.join("\n") + "\n";

  const tmpPath = state.filePath + `.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, state.filePath);
}

/**
 * Serialize async operations per repo to prevent concurrent JSONL writes.
 */
function withMutex<T>(state: RepoState, fn: () => Promise<T>): Promise<T> {
  const work = state.mutex.then(
    () => fn(),
    () => fn()
  );
  state.mutex = work.catch(() => {});
  return work;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function createIssue(
  repoPath: string,
  title: string,
  options: {
    type?: string;
    priority?: number;
    description?: string;
    parentId?: string;
    owner?: string;
    created_by?: string;
  } = {}
): Promise<BeadsIssue> {
  const state = await loadState(repoPath);
  return withMutex(state, async () => {
    await refreshIfStale(state);

    let id: string;
    if (options.parentId) {
      id = generateChildId(state, options.parentId);
    } else {
      id = generateTopLevelId(state);
    }

    const now = nowIso();
    const issue: BeadsIssue = {
      id,
      title,
      description: options.description ?? "",
      issue_type: options.type ?? "task",
      status: "open",
      priority: options.priority ?? 2,
      owner: options.owner ?? null,
      created_at: now,
      created_by: options.created_by ?? "",
      updated_at: now,
    };

    if (options.parentId) {
      issue.dependencies = [
        {
          issue_id: id,
          depends_on_id: options.parentId,
          type: "parent-child",
          created_at: now,
          created_by: options.created_by ?? "",
          metadata: "{}",
        },
      ];
    }

    state.issues.set(id, issue);
    await flushToDisk(state);
    invalidateJsonlCache(repoPath);
    log.info("Created issue", { id, title });
    return issue;
  });
}

export async function updateIssue(
  repoPath: string,
  id: string,
  options: {
    status?: string;
    assignee?: string;
    description?: string;
    priority?: number;
    claim?: boolean;
  } = {}
): Promise<BeadsIssue> {
  const state = await loadState(repoPath);
  return withMutex(state, async () => {
    await refreshIfStale(state);
    const issue = state.issues.get(id);
    if (!issue) throw new AppError(404, ErrorCodes.ISSUE_NOT_FOUND, `Issue ${id} not found`, { issueId: id });

    if (options.status !== undefined) issue.status = options.status;
    if (options.assignee !== undefined) issue.assignee = options.assignee;
    if (options.description !== undefined) issue.description = options.description;
    if (options.priority !== undefined) issue.priority = options.priority;
    if (options.claim) {
      issue.status = "in_progress";
      issue.assignee = options.assignee ?? issue.assignee;
    }
    issue.updated_at = nowIso();

    state.issues.set(id, issue);
    await flushToDisk(state);
    invalidateJsonlCache(repoPath);
    return issue;
  });
}

export async function closeIssue(
  repoPath: string,
  id: string,
  reason: string
): Promise<BeadsIssue> {
  const state = await loadState(repoPath);
  return withMutex(state, async () => {
    await refreshIfStale(state);
    const issue = state.issues.get(id);
    if (!issue) throw new AppError(404, ErrorCodes.ISSUE_NOT_FOUND, `Issue ${id} not found`, { issueId: id });

    const now = nowIso();
    issue.status = "closed";
    issue.updated_at = now;
    (issue as Record<string, unknown>).closed_at = now;
    (issue as Record<string, unknown>).close_reason = reason;

    state.issues.set(id, issue);
    await flushToDisk(state);
    invalidateJsonlCache(repoPath);
    log.info("Closed issue", { id, reason });
    return issue;
  });
}

export async function deleteIssue(repoPath: string, id: string): Promise<void> {
  const state = await loadState(repoPath);
  return withMutex(state, async () => {
    await refreshIfStale(state);
    state.issues.delete(id);
    await flushToDisk(state);
    invalidateJsonlCache(repoPath);
    log.info("Deleted issue", { id });
  });
}

export async function addDependency(
  repoPath: string,
  childId: string,
  parentId: string,
  type?: string
): Promise<void> {
  const state = await loadState(repoPath);
  return withMutex(state, async () => {
    await refreshIfStale(state);
    const issue = state.issues.get(childId);
    if (!issue) throw new AppError(404, ErrorCodes.ISSUE_NOT_FOUND, `Issue ${childId} not found`, { issueId: childId });

    const deps = ((issue.dependencies as unknown[]) ?? []) as Array<Record<string, unknown>>;
    deps.push({
      issue_id: childId,
      depends_on_id: parentId,
      type: type ?? "blocks",
      created_at: nowIso(),
      created_by: "",
      metadata: "{}",
    });
    (issue as Record<string, unknown>).dependencies = deps;
    issue.updated_at = nowIso();

    state.issues.set(childId, issue);
    await flushToDisk(state);
    invalidateJsonlCache(repoPath);
  });
}

export async function addLabel(repoPath: string, id: string, label: string): Promise<void> {
  const state = await loadState(repoPath);
  return withMutex(state, async () => {
    await refreshIfStale(state);
    const issue = state.issues.get(id);
    if (!issue) throw new AppError(404, ErrorCodes.ISSUE_NOT_FOUND, `Issue ${id} not found`, { issueId: id });

    const labels = ((issue.labels ?? []) as string[]).slice();
    if (!labels.includes(label)) {
      labels.push(label);
    }
    issue.labels = labels;
    issue.updated_at = nowIso();

    state.issues.set(id, issue);
    await flushToDisk(state);
    invalidateJsonlCache(repoPath);
  });
}

export async function removeLabel(repoPath: string, id: string, label: string): Promise<void> {
  const state = await loadState(repoPath);
  return withMutex(state, async () => {
    await refreshIfStale(state);
    const issue = state.issues.get(id);
    if (!issue) throw new AppError(404, ErrorCodes.ISSUE_NOT_FOUND, `Issue ${id} not found`, { issueId: id });

    issue.labels = ((issue.labels ?? []) as string[]).filter((l) => l !== label);
    issue.updated_at = nowIso();

    state.issues.set(id, issue);
    await flushToDisk(state);
    invalidateJsonlCache(repoPath);
  });
}

/**
 * Notify that the JSONL was written externally (e.g. by bd CLI via export).
 * Invalidates the in-memory state so the next operation re-reads from disk.
 */
export function invalidateStoreCache(repoPath: string): void {
  const key = resolveKey(repoPath);
  repoStates.delete(key);
  pendingLoads.delete(key);
  invalidateJsonlCache(repoPath);
}

/** Clear all cached state (for tests). */
export function clearStoreCache(): void {
  repoStates.clear();
  pendingLoads.clear();
}

// ─── ID generation ───────────────────────────────────────────────────────────

function generateTopLevelId(state: RepoState): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const hash = generateBase36(ID_LENGTH);
    const id = `${state.prefix}-${hash}`;
    if (!state.issues.has(id)) return id;
  }
  // Extremely unlikely: fall back to longer ID
  const hash = generateBase36(8);
  return `${state.prefix}-${hash}`;
}

function generateChildId(state: RepoState, parentId: string): string {
  let maxSuffix = 0;
  for (const existingId of state.issues.keys()) {
    if (existingId.startsWith(parentId + ".")) {
      const suffix = existingId.slice(parentId.length + 1);
      const parts = suffix.split(".");
      const num = parseInt(parts[0]!, 10);
      if (!isNaN(num) && num > maxSuffix) maxSuffix = num;
    }
  }
  return `${parentId}.${maxSuffix + 1}`;
}
