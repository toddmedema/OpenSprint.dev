import fs from "fs/promises";
import path from "path";
import type { BeadsIssue } from "./beads.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("jsonl-reader");

/**
 * In-memory cache of parsed JSONL issues, invalidated by mtime.
 * Bypasses the bd CLI entirely for read operations — no mutex, no sync, no process spawn.
 */
interface JsonlSnapshot {
  mtimeMs: number;
  issues: BeadsIssue[];
  byId: Map<string, BeadsIssue>;
}

const snapshotCache = new Map<string, JsonlSnapshot>();

function jsonlPath(repoPath: string): string {
  return path.join(repoPath, ".beads/issues.jsonl");
}

function cacheKey(repoPath: string): string {
  return path.resolve(repoPath);
}

async function getMtime(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

function parseJsonlContent(content: string): BeadsIssue[] {
  const byId = new Map<string, BeadsIssue>();
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const issue = JSON.parse(line) as BeadsIssue;
      if (!issue.id) continue;
      byId.set(issue.id, issue);
    } catch {
      log.warn("Skipping malformed JSONL line", { lineNumber: i + 1 });
    }
  }

  return Array.from(byId.values());
}

/**
 * Read and parse all issues from .beads/issues.jsonl.
 * Returns a cached result if the file hasn't been modified since last read.
 * ~1-5ms for a typical project (vs 200-600ms per bd CLI call).
 */
export async function readAllIssuesFromJsonl(repoPath: string): Promise<BeadsIssue[]> {
  const key = cacheKey(repoPath);
  const filePath = jsonlPath(repoPath);
  const mtime = await getMtime(filePath);

  const cached = snapshotCache.get(key);
  if (cached && cached.mtimeMs === mtime && mtime > 0) {
    return cached.issues;
  }

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const issues = parseJsonlContent(content);
  const byId = new Map(issues.map((i) => [i.id, i]));

  snapshotCache.set(key, { mtimeMs: mtime, issues, byId });
  return issues;
}

/**
 * Look up a single issue by ID from the JSONL cache.
 * Returns undefined if not found.
 */
export async function readIssueFromJsonl(
  repoPath: string,
  id: string,
): Promise<BeadsIssue | undefined> {
  const key = cacheKey(repoPath);
  const filePath = jsonlPath(repoPath);
  const mtime = await getMtime(filePath);

  const cached = snapshotCache.get(key);
  if (cached && cached.mtimeMs === mtime && mtime > 0) {
    return cached.byId.get(id);
  }

  // Cache miss or stale — read and parse the full file, then look up
  await readAllIssuesFromJsonl(repoPath);
  const refreshed = snapshotCache.get(key);
  return refreshed?.byId.get(id);
}

/**
 * Build an id→issue map from the JSONL cache.
 * Avoids re-parsing if mtime hasn't changed.
 */
export async function readIssueMapFromJsonl(
  repoPath: string,
): Promise<Map<string, BeadsIssue>> {
  const key = cacheKey(repoPath);
  const filePath = jsonlPath(repoPath);
  const mtime = await getMtime(filePath);

  const cached = snapshotCache.get(key);
  if (cached && cached.mtimeMs === mtime && mtime > 0) {
    return cached.byId;
  }

  await readAllIssuesFromJsonl(repoPath);
  const refreshed = snapshotCache.get(key);
  return refreshed?.byId ?? new Map();
}

/** Invalidate the JSONL cache for a repo (call after writes). */
export function invalidateJsonlCache(repoPath: string): void {
  snapshotCache.delete(cacheKey(repoPath));
}

/** Clear all cached snapshots (for tests). */
export function clearJsonlCache(): void {
  snapshotCache.clear();
}
