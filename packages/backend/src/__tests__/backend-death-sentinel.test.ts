import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startBackendDeathSentinel } from "../utils/backend-death-sentinel.js";
import * as child_process from "child_process";
import * as runtimeTrace from "../utils/runtime-trace.js";

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof child_process>("child_process");
  return { ...actual, spawn: vi.fn() };
});

vi.mock("../utils/runtime-trace.js", () => ({
  appendRuntimeTrace: vi.fn(),
}));

describe("startBackendDeathSentinel", () => {
  const mockChild = {
    unref: vi.fn(),
    pid: 99999,
  };

  beforeEach(() => {
    vi.mocked(child_process.spawn).mockReturnValue(mockChild as unknown as child_process.ChildProcess);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getSpawnArgs() {
    return vi.mocked(child_process.spawn).mock.calls[0];
  }

  function getScript(): string {
    // spawn(execPath, ["-e", script, backendPid, parentPid, sessionId], opts)
    return getSpawnArgs()[1]![1] as string;
  }

  it("spawns a detached node process with the correct arguments", () => {
    startBackendDeathSentinel({
      sessionId: "test-session",
      backendPid: 1234,
      parentPid: 5678,
    });

    expect(child_process.spawn).toHaveBeenCalledTimes(1);
    const [exec, args, opts] = getSpawnArgs();
    expect(exec).toBe(process.execPath);
    expect(args).toHaveLength(5);
    expect(args![0]).toBe("-e");
    expect(args![1]).toContain("sentinel.start");
    expect(args![2]).toBe("1234");
    expect(args![3]).toBe("5678");
    expect(args![4]).toBe("test-session");
    expect(opts).toMatchObject({ detached: true, stdio: "ignore" });
    expect((opts as { env: Record<string, string> }).env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("unrefs the child so the backend can exit normally", () => {
    startBackendDeathSentinel({
      sessionId: "test-session",
      backendPid: 1234,
      parentPid: 5678,
    });

    expect(mockChild.unref).toHaveBeenCalledTimes(1);
  });

  it("logs sentinel_started trace on success", () => {
    startBackendDeathSentinel({
      sessionId: "test-session",
      backendPid: 1234,
      parentPid: 5678,
    });

    expect(runtimeTrace.appendRuntimeTrace).toHaveBeenCalledWith(
      "process.sentinel_started",
      "test-session",
      expect.objectContaining({
        watcherPid: 99999,
        backendPid: 1234,
        parentPid: 5678,
      })
    );
  });

  it("logs sentinel_failed trace when spawn throws", () => {
    vi.mocked(child_process.spawn).mockImplementation(() => {
      throw new Error("spawn ENOENT");
    });

    startBackendDeathSentinel({
      sessionId: "test-session",
      backendPid: 1234,
      parentPid: 5678,
    });

    expect(runtimeTrace.appendRuntimeTrace).toHaveBeenCalledWith(
      "process.sentinel_failed",
      "test-session",
      expect.objectContaining({
        backendPid: 1234,
        parentPid: 5678,
        err: expect.objectContaining({ message: "spawn ENOENT" }),
      })
    );
  });

  describe("sentinel script content", () => {
    it("generates syntactically valid JavaScript", () => {
      startBackendDeathSentinel({
        sessionId: "test-session",
        backendPid: 1,
        parentPid: 2,
      });

      expect(() => new Function(getScript())).not.toThrow();
    });

    it("includes parent.disappeared event handler", () => {
      startBackendDeathSentinel({ sessionId: "s", backendPid: 1, parentPid: 2 });
      expect(getScript()).toContain("parent.disappeared");
    });

    it("includes sentinel.heartbeat event", () => {
      startBackendDeathSentinel({ sessionId: "s", backendPid: 1, parentPid: 2 });
      expect(getScript()).toContain("sentinel.heartbeat");
    });

    it("includes SIGTERM/SIGINT termination handlers", () => {
      startBackendDeathSentinel({ sessionId: "s", backendPid: 1, parentPid: 2 });
      const script = getScript();
      expect(script).toContain("sentinel.terminated");
      expect(script).toContain("SIGTERM");
      expect(script).toContain("SIGINT");
    });

    it("includes startedAtIso in the write function output", () => {
      startBackendDeathSentinel({ sessionId: "s", backendPid: 1, parentPid: 2 });
      expect(getScript()).toContain("startedAtIso");
    });

    it("writes newline-delimited JSON (appends \\n after stringify)", () => {
      startBackendDeathSentinel({ sessionId: "s", backendPid: 1, parentPid: 2 });
      const script = getScript();
      // In the template literal, "\\n" becomes "\n" in the script string —
      // which is the literal two characters backslash-n (a JS newline escape).
      expect(script).toContain('+ "\\n"');
    });
  });
});
