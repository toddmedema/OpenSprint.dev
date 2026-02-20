/**
 * Short-TTL cache for beads CLI results to reduce redundant bd invocations.
 * Used by task detail loading to avoid repeated listAll/show calls when switching tasks.
 */

const TTL_MS = 2000; // 2 seconds

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const listAllCache = new Map<string, CacheEntry<unknown>>();
const showCache = new Map<string, CacheEntry<unknown>>();

function listAllKey(repoPath: string): string {
  return `listAll:${repoPath}`;
}

function showKey(repoPath: string, id: string): string {
  return `show:${repoPath}:${id}`;
}

function get<T>(cache: Map<string, CacheEntry<unknown>>, key: string): T | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || Date.now() >= entry.expiresAt) {
    if (entry) cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function set<T>(cache: Map<string, CacheEntry<unknown>>, key: string, value: T): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + TTL_MS,
  });
}

function sweep(cache: Map<string, CacheEntry<unknown>>): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) cache.delete(key);
  }
}

const sweepTimer = setInterval(() => {
  sweep(listAllCache);
  sweep(showCache);
}, 30_000);
if (sweepTimer.unref) sweepTimer.unref();

export const beadsCache = {
  getListAll: <T>(repoPath: string): T | undefined => get(listAllCache, listAllKey(repoPath)),
  setListAll: <T>(repoPath: string, value: T): void =>
    set(listAllCache, listAllKey(repoPath), value),
  getShow: <T>(repoPath: string, id: string): T | undefined =>
    get(showCache, showKey(repoPath, id)),
  setShow: <T>(repoPath: string, id: string, value: T): void =>
    set(showCache, showKey(repoPath, id), value),
  /** Invalidate cache for a task mutation (e.g. priority update) so subsequent reads return fresh data */
  invalidateForTask: (repoPath: string, taskId: string): void => {
    listAllCache.delete(listAllKey(repoPath));
    showCache.delete(showKey(repoPath, taskId));
  },
  /** Invalidate listAll cache when beads state changes (e.g. update, close, sync) */
  invalidateListAll: (repoPath: string): void => {
    listAllCache.delete(listAllKey(repoPath));
  },
  clear: (): void => {
    listAllCache.clear();
    showCache.clear();
  },
};
