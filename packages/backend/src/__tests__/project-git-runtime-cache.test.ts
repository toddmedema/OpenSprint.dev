import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ProjectGitRuntimeCache } from "../services/project-git-runtime-cache.js";

describe("ProjectGitRuntimeCache", () => {
  let nowMs: number;
  let inspect: ReturnType<typeof vi.fn>;
  let cache: ProjectGitRuntimeCache;

  beforeEach(() => {
    nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    inspect = vi.fn();
    cache = new ProjectGitRuntimeCache({
      inspect,
      now: () => nowMs,
      ttlMs: 30_000,
    });
  });

  afterEach(() => {
    cache.dispose();
  });

  it("returns fallback state on cache miss and refreshes in background", async () => {
    inspect.mockResolvedValue({
      baseBranch: "main",
      remoteMode: "publishable",
    });

    const first = cache.getSnapshot("proj-1", "/repo", "main");
    expect(first.worktreeBaseBranch).toBe("main");
    expect(first.gitRemoteMode).toBeUndefined();
    expect(first.gitRuntimeStatus).toEqual({
      lastCheckedAt: null,
      stale: true,
      refreshing: true,
    });
    expect(inspect).toHaveBeenCalledTimes(1);

    await cache.waitForRefresh("proj-1");

    const second = cache.getSnapshot("proj-1", "/repo", "main");
    expect(second.worktreeBaseBranch).toBe("main");
    expect(second.gitRemoteMode).toBe("publishable");
    expect(second.gitRuntimeStatus.stale).toBe(false);
    expect(second.gitRuntimeStatus.refreshing).toBe(false);
    expect(second.gitRuntimeStatus.lastCheckedAt).not.toBeNull();
  });

  it("returns stale cached values immediately and refreshes once", async () => {
    inspect.mockResolvedValueOnce({
      baseBranch: "main",
      remoteMode: "publishable",
    });

    cache.getSnapshot("proj-1", "/repo", "main");
    await cache.waitForRefresh("proj-1");

    nowMs += 31_000;
    inspect.mockResolvedValueOnce({
      baseBranch: "develop",
      remoteMode: "remote_error",
    });

    const stale = cache.getSnapshot("proj-1", "/repo", "main");
    expect(stale.worktreeBaseBranch).toBe("main");
    expect(stale.gitRemoteMode).toBe("publishable");
    expect(stale.gitRuntimeStatus.stale).toBe(true);
    expect(stale.gitRuntimeStatus.refreshing).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(2);

    await cache.waitForRefresh("proj-1");

    const refreshed = cache.getSnapshot("proj-1", "/repo", "main");
    expect(refreshed.worktreeBaseBranch).toBe("develop");
    expect(refreshed.gitRemoteMode).toBe("remote_error");
    expect(refreshed.gitRuntimeStatus.stale).toBe(false);
    expect(refreshed.gitRuntimeStatus.refreshing).toBe(false);
  });

  it("dedupes concurrent refresh requests for the same project/context", async () => {
    let resolveInspect:
      | ((value: { baseBranch: string; remoteMode: "publishable" }) => void)
      | null = null;
    inspect.mockImplementation(
      () =>
        new Promise<{ baseBranch: string; remoteMode: "publishable" }>((resolve) => {
          resolveInspect = resolve;
        })
    );

    const first = cache.getSnapshot("proj-1", "/repo", "main");
    const second = cache.getSnapshot("proj-1", "/repo", "main");
    expect(first.gitRuntimeStatus.refreshing).toBe(true);
    expect(second.gitRuntimeStatus.refreshing).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(1);

    resolveInspect?.({ baseBranch: "main", remoteMode: "publishable" });
    await cache.waitForRefresh("proj-1");
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("invalidates stale context and falls back immediately when preferred branch changes", async () => {
    inspect.mockResolvedValueOnce({
      baseBranch: "main",
      remoteMode: "publishable",
    });
    cache.getSnapshot("proj-1", "/repo", "main");
    await cache.waitForRefresh("proj-1");

    inspect.mockResolvedValueOnce({
      baseBranch: "develop",
      remoteMode: "publishable",
    });
    const changed = cache.getSnapshot("proj-1", "/repo", "develop");
    expect(changed.worktreeBaseBranch).toBe("develop");
    expect(changed.gitRemoteMode).toBeUndefined();
    expect(changed.gitRuntimeStatus.stale).toBe(true);
    expect(changed.gitRuntimeStatus.refreshing).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(2);
  });
});
