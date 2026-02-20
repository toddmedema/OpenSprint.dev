/**
 * Short-TTL cache for listTasks results to reduce redundant pipeline runs.
 * Rapid page loads and duplicate requests return instantly from cache.
 * Invalidated on task mutations (create, update, close).
 */

import type { Task } from "@opensprint/shared";

const TTL_MS = 7_000; // 7 seconds (within 5-10s range)

interface CacheEntry {
  value: Task[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function key(repoPath: string): string {
  return `listTasks:${repoPath}`;
}

function get(repoPath: string): Task[] | undefined {
  const entry = cache.get(key(repoPath));
  if (!entry || Date.now() >= entry.expiresAt) {
    if (entry) cache.delete(key(repoPath));
    return undefined;
  }
  return entry.value;
}

function set(repoPath: string, value: Task[]): void {
  cache.set(key(repoPath), {
    value,
    expiresAt: Date.now() + TTL_MS,
  });
}

function sweep(): void {
  const now = Date.now();
  for (const [k, entry] of cache) {
    if (now >= entry.expiresAt) cache.delete(k);
  }
}

const sweepTimer = setInterval(sweep, 30_000);
if (sweepTimer.unref) sweepTimer.unref();

export const listTasksCache = {
  get: (repoPath: string): Task[] | undefined => get(repoPath),
  set: (repoPath: string, value: Task[]): void => set(repoPath, value),
  invalidate: (repoPath: string): void => {
    cache.delete(key(repoPath));
  },
  clear: (): void => {
    cache.clear();
  },
};
