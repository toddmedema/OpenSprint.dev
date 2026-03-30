import { describe, it, expect, beforeEach } from "vitest";
import { activeAgentsService } from "../services/active-agents.service.js";
import { PendingMessageQueue } from "../services/agentic-loop.js";

describe("ActiveAgentsService", () => {
  beforeEach(() => {
    // Clear the registry before each test (service is a singleton with shared state)
    const list = activeAgentsService.list();
    for (const agent of list) {
      activeAgentsService.unregister(agent.id);
    }
  });

  describe("register", () => {
    it("adds an agent to the registry", () => {
      activeAgentsService.register(
        "task-1",
        "proj-1",
        "coding",
        "coder",
        "Implement login",
        "2026-02-16T10:00:00.000Z"
      );

      const agents = activeAgentsService.list();
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({
        id: "task-1",
        phase: "coding",
        role: "coder",
        label: "Implement login",
        startedAt: "2026-02-16T10:00:00.000Z",
        name: "Frodo",
      });
    });

    it("includes name when provided", () => {
      activeAgentsService.register(
        "task-name",
        "proj-1",
        "coding",
        "coder",
        "Task with name",
        "2026-02-16T10:00:00.000Z",
        undefined,
        undefined,
        "Frodo"
      );

      const agents = activeAgentsService.list();
      expect(agents[0]).toMatchObject({
        id: "task-name",
        role: "coder",
        name: "Frodo",
      });
      activeAgentsService.unregister("task-name");
    });

    it("includes branchName when provided", () => {
      activeAgentsService.register(
        "task-2",
        "proj-1",
        "coding",
        "coder",
        "Add tests",
        "2026-02-16T10:05:00.000Z",
        "opensprint/task-2"
      );

      const agents = activeAgentsService.list();
      expect(agents[0]).toMatchObject({
        id: "task-2",
        role: "coder",
        branchName: "opensprint/task-2",
      });
    });

    it("includes feedbackId when Analyst is categorizing feedback", () => {
      activeAgentsService.register(
        "feedback-categorize-proj-1-fsi69v-123",
        "proj-1",
        "eval",
        "analyst",
        "Feedback categorization",
        "2026-02-16T10:00:00.000Z",
        undefined,
        undefined,
        undefined,
        "fsi69v"
      );

      const agents = activeAgentsService.list("proj-1");
      expect(agents[0]).toMatchObject({
        id: "feedback-categorize-proj-1-fsi69v-123",
        role: "analyst",
        feedbackId: "fsi69v",
      });
      activeAgentsService.unregister("feedback-categorize-proj-1-fsi69v-123");
    });

    it("includes taskId when provided (e.g. merger run id vs task)", () => {
      activeAgentsService.register(
        "merger-proj-1-os-99-1-ts-x",
        "proj-1",
        "execute",
        "merger",
        "Merger conflict resolution",
        "2026-02-16T10:00:00.000Z",
        "opensprint/os-99",
        undefined,
        undefined,
        undefined,
        "os-99.1"
      );

      const agents = activeAgentsService.list("proj-1");
      expect(agents[0]).toMatchObject({
        id: "merger-proj-1-os-99-1-ts-x",
        role: "merger",
        taskId: "os-99.1",
      });
      activeAgentsService.unregister("merger-proj-1-os-99-1-ts-x");
    });

    it("overwrites existing agent with same id", () => {
      activeAgentsService.register(
        "task-1",
        "proj-1",
        "coding",
        "coder",
        "Old",
        "2026-02-16T10:00:00.000Z"
      );
      activeAgentsService.register(
        "task-1",
        "proj-1",
        "review",
        "reviewer",
        "New",
        "2026-02-16T10:10:00.000Z"
      );

      const agents = activeAgentsService.list();
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({
        id: "task-1",
        phase: "review",
        role: "reviewer",
        label: "New",
        startedAt: "2026-02-16T10:10:00.000Z",
        name: "Boromir",
      });
    });
  });

  describe("unregister", () => {
    it("removes an agent by id", () => {
      activeAgentsService.register(
        "task-1",
        "proj-1",
        "coding",
        "coder",
        "Task",
        "2026-02-16T10:00:00.000Z"
      );

      activeAgentsService.unregister("task-1");

      expect(activeAgentsService.list()).toHaveLength(0);
    });

    it("is safe to call when agent was never registered", () => {
      expect(() => activeAgentsService.unregister("nonexistent")).not.toThrow();
    });

    it("does not affect other agents", () => {
      activeAgentsService.register(
        "task-1",
        "proj-1",
        "coding",
        "coder",
        "Task 1",
        "2026-02-16T10:00:00.000Z"
      );
      activeAgentsService.register(
        "task-2",
        "proj-1",
        "coding",
        "coder",
        "Task 2",
        "2026-02-16T10:01:00.000Z"
      );

      activeAgentsService.unregister("task-1");

      const agents = activeAgentsService.list();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe("task-2");
    });
  });

  describe("list", () => {
    it("returns empty array when no agents registered", () => {
      expect(activeAgentsService.list()).toEqual([]);
    });

    it("returns all agents when no projectId filter", () => {
      activeAgentsService.register(
        "task-1",
        "proj-1",
        "coding",
        "coder",
        "Task 1",
        "2026-02-16T10:00:00.000Z"
      );
      activeAgentsService.register(
        "task-2",
        "proj-2",
        "review",
        "reviewer",
        "Task 2",
        "2026-02-16T10:01:00.000Z"
      );

      const agents = activeAgentsService.list();
      expect(agents).toHaveLength(2);
    });

    it("filters by projectId when provided", () => {
      activeAgentsService.register(
        "task-1",
        "proj-1",
        "coding",
        "coder",
        "Task 1",
        "2026-02-16T10:00:00.000Z"
      );
      activeAgentsService.register(
        "task-2",
        "proj-2",
        "review",
        "reviewer",
        "Task 2",
        "2026-02-16T10:01:00.000Z"
      );
      activeAgentsService.register(
        "task-3",
        "proj-1",
        "coding",
        "coder",
        "Task 3",
        "2026-02-16T10:02:00.000Z"
      );

      const agents = activeAgentsService.list("proj-1");
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.id)).toContain("task-1");
      expect(agents.map((a) => a.id)).toContain("task-3");
    });

    it("returns empty array for non-existent projectId", () => {
      activeAgentsService.register(
        "task-1",
        "proj-1",
        "coding",
        "coder",
        "Task 1",
        "2026-02-16T10:00:00.000Z"
      );

      expect(activeAgentsService.list("proj-999")).toEqual([]);
    });

    it("omits projectId from response (API compatibility)", () => {
      activeAgentsService.register(
        "task-1",
        "proj-1",
        "sketch",
        "dreamer",
        "PRD draft",
        "2026-02-16T10:00:00.000Z"
      );

      const agents = activeAgentsService.list("proj-1");
      expect(agents[0]).not.toHaveProperty("projectId");
      expect(agents[0]).toMatchObject({
        id: "task-1",
        phase: "sketch",
        role: "dreamer",
        label: "PRD draft",
        startedAt: "2026-02-16T10:00:00.000Z",
      });
    });
  });

  describe("registerChannel / getChannel", () => {
    it("stores and retrieves a pending-messages channel for a task", () => {
      const queue = new PendingMessageQueue();
      activeAgentsService.registerChannel("task-ch-1", queue, "claude");

      const entry = activeAgentsService.getChannel("task-ch-1");
      expect(entry).toBeDefined();
      expect(entry!.pendingMessages).toBe(queue);
      expect(entry!.backendType).toBe("claude");
    });

    it("returns undefined for unregistered task", () => {
      expect(activeAgentsService.getChannel("nonexistent")).toBeUndefined();
    });

    it("overwrites channel when re-registered", () => {
      const queue1 = new PendingMessageQueue();
      const queue2 = new PendingMessageQueue();
      activeAgentsService.registerChannel("task-ch-2", queue1, "openai");
      activeAgentsService.registerChannel("task-ch-2", queue2, "google");

      const entry = activeAgentsService.getChannel("task-ch-2");
      expect(entry!.pendingMessages).toBe(queue2);
      expect(entry!.backendType).toBe("google");
    });

    it("supports pushing messages through the registered channel", () => {
      const queue = new PendingMessageQueue();
      activeAgentsService.registerChannel("task-ch-3", queue, "claude");

      const entry = activeAgentsService.getChannel("task-ch-3");
      const accepted = entry!.pendingMessages.push("Hello from user");
      expect(accepted).toBe(true);
      expect(entry!.pendingMessages.size).toBe(1);

      const drained = entry!.pendingMessages.drain();
      expect(drained).toHaveLength(1);
      expect(drained[0].message).toBe("Hello from user");
    });
  });

  describe("unregister cleans up channels", () => {
    it("removes the channel when the agent is unregistered", () => {
      const queue = new PendingMessageQueue();
      activeAgentsService.register(
        "task-cleanup-1",
        "proj-1",
        "coding",
        "coder",
        "Task with channel",
        "2026-02-16T10:00:00.000Z"
      );
      activeAgentsService.registerChannel("task-cleanup-1", queue, "claude");

      expect(activeAgentsService.getChannel("task-cleanup-1")).toBeDefined();

      activeAgentsService.unregister("task-cleanup-1");

      expect(activeAgentsService.getChannel("task-cleanup-1")).toBeUndefined();
      expect(activeAgentsService.list()).toHaveLength(0);
    });

    it("does not affect channels of other tasks", () => {
      const queue1 = new PendingMessageQueue();
      const queue2 = new PendingMessageQueue();
      activeAgentsService.registerChannel("task-a", queue1, "openai");
      activeAgentsService.registerChannel("task-b", queue2, "google");

      activeAgentsService.unregister("task-a");

      expect(activeAgentsService.getChannel("task-a")).toBeUndefined();
      expect(activeAgentsService.getChannel("task-b")).toBeDefined();
      expect(activeAgentsService.getChannel("task-b")!.pendingMessages).toBe(queue2);
    });

    it("is safe to unregister a task with no channel", () => {
      activeAgentsService.register(
        "task-no-channel",
        "proj-1",
        "coding",
        "coder",
        "No channel",
        "2026-02-16T10:00:00.000Z"
      );

      expect(() => activeAgentsService.unregister("task-no-channel")).not.toThrow();
    });
  });
});
