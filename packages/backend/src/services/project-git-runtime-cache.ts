import type { GitRuntimeStatus } from "@opensprint/shared";
import { inspectGitRepoState, type GitRemoteMode } from "../utils/git-repo-state.js";

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_SWEEP_MS = 30_000;

interface CacheEntry {
  repoPath: string;
  preferredBaseBranch: string;
  worktreeBaseBranch: string;
  gitRemoteMode: GitRemoteMode;
  lastCheckedAt: string;
  expiresAt: number;
}

interface InFlightRefresh {
  promise: Promise<void>;
  repoPath: string;
  preferredBaseBranch: string;
  generation: number;
  refreshId: number;
}

type InspectResult = {
  baseBranch: string;
  remoteMode: GitRemoteMode;
};

type InspectFn = (repoPath: string, preferredBaseBranch?: string | null) => Promise<InspectResult>;

interface ProjectGitRuntimeCacheDeps {
  inspect?: InspectFn;
  now?: () => number;
  ttlMs?: number;
}

export interface RuntimeSnapshot {
  worktreeBaseBranch: string;
  gitRemoteMode: GitRemoteMode | undefined;
  gitRuntimeStatus: GitRuntimeStatus;
}

export class ProjectGitRuntimeCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlightRefresh>();
  private readonly generations = new Map<string, number>();
  private refreshCounter = 0;
  private readonly inspect: InspectFn;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(deps: ProjectGitRuntimeCacheDeps = {}) {
    this.inspect = deps.inspect ?? inspectGitRepoState;
    this.now = deps.now ?? Date.now;
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
    this.sweepTimer = setInterval(
      () => this.sweepExpired(),
      Math.min(this.ttlMs, DEFAULT_SWEEP_MS)
    );
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  getSnapshot(projectId: string, repoPath: string, preferredBaseBranch: string): RuntimeSnapshot {
    const normalizedPreferredBaseBranch = this.normalizePreferredBaseBranch(preferredBaseBranch);
    const entry = this.cache.get(projectId);
    if (
      entry &&
      (entry.repoPath !== repoPath || entry.preferredBaseBranch !== normalizedPreferredBaseBranch)
    ) {
      this.cache.delete(projectId);
    }

    const current = this.cache.get(projectId);
    const inFlight = this.getMatchingInFlight(projectId, repoPath, normalizedPreferredBaseBranch);

    if (current) {
      const stale = this.now() >= current.expiresAt;
      if (stale) {
        this.refreshInBackground(projectId, repoPath, normalizedPreferredBaseBranch);
      }
      return {
        worktreeBaseBranch: current.worktreeBaseBranch,
        gitRemoteMode: current.gitRemoteMode,
        gitRuntimeStatus: {
          lastCheckedAt: current.lastCheckedAt,
          stale,
          refreshing: stale || Boolean(inFlight),
        },
      };
    }

    this.refreshInBackground(projectId, repoPath, normalizedPreferredBaseBranch);
    return {
      worktreeBaseBranch: normalizedPreferredBaseBranch,
      gitRemoteMode: undefined,
      gitRuntimeStatus: {
        lastCheckedAt: null,
        stale: true,
        refreshing: true,
      },
    };
  }

  refreshInBackground(projectId: string, repoPath: string, preferredBaseBranch: string): void {
    const normalizedPreferredBaseBranch = this.normalizePreferredBaseBranch(preferredBaseBranch);
    const generation = this.getGeneration(projectId);
    const existing = this.inFlight.get(projectId);
    if (
      existing &&
      existing.generation === generation &&
      existing.repoPath === repoPath &&
      existing.preferredBaseBranch === normalizedPreferredBaseBranch
    ) {
      return;
    }

    const refreshId = ++this.refreshCounter;
    const promise = this.inspect(repoPath, normalizedPreferredBaseBranch)
      .then((repoState) => {
        const current = this.inFlight.get(projectId);
        if (!current || current.refreshId !== refreshId) return;
        if (this.getGeneration(projectId) !== generation) return;
        const now = this.now();
        this.cache.set(projectId, {
          repoPath,
          preferredBaseBranch: normalizedPreferredBaseBranch,
          worktreeBaseBranch: repoState.baseBranch,
          gitRemoteMode: repoState.remoteMode,
          lastCheckedAt: new Date(now).toISOString(),
          expiresAt: now + this.ttlMs,
        });
      })
      .catch(() => {
        // Best effort background refresh: preserve previous cache entry on failure.
      })
      .finally(() => {
        const current = this.inFlight.get(projectId);
        if (current && current.refreshId === refreshId) {
          this.inFlight.delete(projectId);
        }
      });

    this.inFlight.set(projectId, {
      promise,
      repoPath,
      preferredBaseBranch: normalizedPreferredBaseBranch,
      generation,
      refreshId,
    });
  }

  invalidate(projectId: string): void {
    this.cache.delete(projectId);
    this.bumpGeneration(projectId);
  }

  async waitForRefresh(projectId: string): Promise<void> {
    await this.inFlight.get(projectId)?.promise;
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
    this.generations.clear();
  }

  dispose(): void {
    clearInterval(this.sweepTimer);
    this.clear();
  }

  private getGeneration(projectId: string): number {
    return this.generations.get(projectId) ?? 0;
  }

  private bumpGeneration(projectId: string): void {
    this.generations.set(projectId, this.getGeneration(projectId) + 1);
  }

  private getMatchingInFlight(
    projectId: string,
    repoPath: string,
    preferredBaseBranch: string
  ): InFlightRefresh | undefined {
    const generation = this.getGeneration(projectId);
    const current = this.inFlight.get(projectId);
    if (!current) return undefined;
    if (
      current.generation !== generation ||
      current.repoPath !== repoPath ||
      current.preferredBaseBranch !== preferredBaseBranch
    ) {
      return undefined;
    }
    return current;
  }

  private sweepExpired(): void {
    const now = this.now();
    for (const [projectId, entry] of this.cache.entries()) {
      // Keep one stale window so callers can return cached values immediately while a refresh runs.
      if (now >= entry.expiresAt + this.ttlMs) {
        this.cache.delete(projectId);
      }
    }
  }

  private normalizePreferredBaseBranch(preferredBaseBranch: string): string {
    const trimmed = preferredBaseBranch.trim();
    return trimmed.length > 0 ? trimmed : "main";
  }
}

export const projectGitRuntimeCache = new ProjectGitRuntimeCache();
