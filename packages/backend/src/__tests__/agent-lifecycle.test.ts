import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentLifecycleManager } from "../services/agent-lifecycle.js";
import type { AgentRunState, AgentRunParams } from "../services/agent-lifecycle.js";
import { TimerRegistry } from "../services/timer-registry.js";

const mockInvokeCodingAgent = vi.fn();
const mockInvokeReviewAgent = vi.fn();
const mockWriteHeartbeat = vi.fn().mockResolvedValue(undefined);
const mockDeleteHeartbeat = vi.fn().mockResolvedValue(undefined);
const mockBroadcastToProject = vi.fn();
const mockSendAgentOutputToProject = vi.fn();
const mockCommitWip = vi.fn().mockResolvedValue(undefined);

vi.mock("../services/agent.service.js", () => ({
  agentService: {
    invokeCodingAgent: (...args: unknown[]) => mockInvokeCodingAgent(...args),
    invokeReviewAgent: (...args: unknown[]) => mockInvokeReviewAgent(...args),
  },
}));

vi.mock("../services/heartbeat.service.js", () => ({
  heartbeatService: {
    writeHeartbeat: (...args: unknown[]) => mockWriteHeartbeat(...args),
    deleteHeartbeat: (...args: unknown[]) => mockDeleteHeartbeat(...args),
  },
}));

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: (...args: unknown[]) => mockBroadcastToProject(...args),
  sendAgentOutputToProject: (...args: unknown[]) => mockSendAgentOutputToProject(...args),
}));

vi.mock("../services/branch-manager.js", () => ({
  BranchManager: vi.fn().mockImplementation(() => ({
    commitWip: (...args: unknown[]) => mockCommitWip(...args),
  })),
}));

describe("AgentLifecycleManager", () => {
  let manager: AgentLifecycleManager;
  let timers: TimerRegistry;
  let runState: AgentRunState;

  const baseParams: AgentRunParams = {
    projectId: "proj-1",
    taskId: "task-1",
    phase: "coding",
    wtPath: "/tmp/repo",
    branchName: "main",
    promptPath: "/tmp/prompt.md",
    agentConfig: { type: "cursor", model: "gpt-4" },
    agentLabel: "Coder",
    role: "coder",
    onDone: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentLifecycleManager();
    timers = new TimerRegistry();
    runState = {
      activeProcess: null,
      lastOutputTime: 0,
      outputLog: [],
      outputLogBytes: 0,
      startedAt: "",
      exitHandled: false,
      killedDueToTimeout: false,
    };

    const mockHandle = {
      kill: vi.fn(),
      pid: 9999,
    };

    mockInvokeCodingAgent.mockImplementation((_path: string, _config: unknown, options: { onExit?: (code: number | null) => void }) => {
      return mockHandle;
    });

    mockInvokeReviewAgent.mockImplementation((_path: string, _config: unknown, options: { onExit?: (code: number | null) => void }) => {
      return mockHandle;
    });
  });

  describe("run", () => {
    it("spawns coder agent and initializes run state", () => {
      manager.run(baseParams, runState, timers);

      expect(mockInvokeCodingAgent).toHaveBeenCalled();
      expect(mockInvokeReviewAgent).not.toHaveBeenCalled();
      expect(runState.activeProcess).not.toBeNull();
      expect(runState.startedAt).toBeTruthy();
      expect(runState.outputLog).toEqual([]);
      expect(runState.exitHandled).toBe(false);
      expect(mockBroadcastToProject).toHaveBeenCalledWith("proj-1", expect.objectContaining({
        type: "agent.started",
        taskId: "task-1",
        phase: "coding",
      }));
      expect(timers.has("heartbeat")).toBe(true);
      expect(timers.has("inactivity")).toBe(true);
    });

    it("spawns reviewer agent when role is reviewer", () => {
      manager.run({ ...baseParams, role: "reviewer" }, runState, timers);

      expect(mockInvokeReviewAgent).toHaveBeenCalled();
      expect(mockInvokeCodingAgent).not.toHaveBeenCalled();
    });

    it("invokes onDone and cleans up when agent exits via onExit", async () => {
      let capturedOnExit: ((code: number | null) => void) | undefined;
      mockInvokeCodingAgent.mockImplementation((_path: string, _config: unknown, options: { onExit?: (code: number | null) => void }) => {
        capturedOnExit = options.onExit;
        return { kill: vi.fn(), pid: 9999 };
      });

      manager.run(baseParams, runState, timers);
      expect(baseParams.onDone).not.toHaveBeenCalled();

      await capturedOnExit?.(0);

      expect(baseParams.onDone).toHaveBeenCalledWith(0);
      expect(runState.activeProcess).toBeNull();
      expect(runState.exitHandled).toBe(true);
      expect(mockDeleteHeartbeat).toHaveBeenCalledWith("/tmp/repo", "task-1");
      expect(timers.has("heartbeat")).toBe(false);
      expect(timers.has("inactivity")).toBe(false);
    });

    it("appends output chunks to runState.outputLog", () => {
      let capturedOnOutput: ((chunk: string) => void) | undefined;
      mockInvokeCodingAgent.mockImplementation((_path: string, _config: unknown, options: { onOutput?: (chunk: string) => void }) => {
        capturedOnOutput = options.onOutput;
        return { kill: vi.fn(), pid: 9999 };
      });

      manager.run(baseParams, runState, timers);

      capturedOnOutput?.("chunk1");
      capturedOnOutput?.("chunk2");

      expect(runState.outputLog).toEqual(["chunk1", "chunk2"]);
      expect(mockSendAgentOutputToProject).toHaveBeenCalledWith("proj-1", "task-1", "chunk1");
      expect(mockSendAgentOutputToProject).toHaveBeenCalledWith("proj-1", "task-1", "chunk2");
    });

    it("does not call onDone twice when onExit is invoked multiple times", async () => {
      let capturedOnExit: ((code: number | null) => void) | undefined;
      mockInvokeCodingAgent.mockImplementation((_path: string, _config: unknown, options: { onExit?: (code: number | null) => void }) => {
        capturedOnExit = options.onExit;
        return { kill: vi.fn(), pid: 9999 };
      });

      manager.run(baseParams, runState, timers);

      await capturedOnExit?.(0);
      await capturedOnExit?.(1);

      expect(baseParams.onDone).toHaveBeenCalledTimes(1);
    });
  });
});
