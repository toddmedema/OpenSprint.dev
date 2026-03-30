import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AgentChatService } from "../services/agent-chat.service.js";
import { ActiveAgentsService } from "../services/active-agents.service.js";
import { PendingMessageQueue } from "../services/agentic-loop.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-chat-test-"));
}

describe("AgentChatService", () => {
  let tmpDir: string;
  let activeAgents: ActiveAgentsService;
  let service: AgentChatService;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    activeAgents = new ActiveAgentsService();
    service = new AgentChatService(activeAgents, tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("appendMessage / getHistory", () => {
    it("persists and reads back a single message", () => {
      const taskId = "os-1234";
      service.appendMessage(taskId, {
        id: "msg-1",
        timestamp: "2026-03-25T10:00:00.000Z",
        role: "user",
        content: "Hello agent",
        attempt: 1,
      });

      const history = service.getHistory("proj-1", taskId);
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual({
        id: "msg-1",
        timestamp: "2026-03-25T10:00:00.000Z",
        role: "user",
        content: "Hello agent",
        attempt: 1,
      });
    });

    it("preserves insertion order across multiple messages", () => {
      const taskId = "os-order";
      const messages = [
        {
          id: "msg-1",
          timestamp: "2026-03-25T10:00:00.000Z",
          role: "user" as const,
          content: "First",
          attempt: 1,
        },
        {
          id: "msg-2",
          timestamp: "2026-03-25T10:00:01.000Z",
          role: "assistant" as const,
          content: "Second",
          attempt: 1,
        },
        {
          id: "msg-3",
          timestamp: "2026-03-25T10:00:02.000Z",
          role: "user" as const,
          content: "Third",
          attempt: 1,
        },
      ];

      for (const msg of messages) {
        service.appendMessage(taskId, msg);
      }

      const history = service.getHistory("proj-1", taskId);
      expect(history).toHaveLength(3);
      expect(history.map((m) => m.id)).toEqual(["msg-1", "msg-2", "msg-3"]);
      expect(history.map((m) => m.content)).toEqual(["First", "Second", "Third"]);
    });

    it("filters by attempt when specified", () => {
      const taskId = "os-attempts";
      service.appendMessage(taskId, {
        id: "msg-a1",
        timestamp: "2026-03-25T10:00:00.000Z",
        role: "user",
        content: "Attempt 1 msg",
        attempt: 1,
      });
      service.appendMessage(taskId, {
        id: "msg-a2",
        timestamp: "2026-03-25T11:00:00.000Z",
        role: "user",
        content: "Attempt 2 msg",
        attempt: 2,
      });
      service.appendMessage(taskId, {
        id: "msg-a1b",
        timestamp: "2026-03-25T10:01:00.000Z",
        role: "assistant",
        content: "Reply to attempt 1",
        attempt: 1,
      });

      const attempt1 = service.getHistory("proj-1", taskId, 1);
      expect(attempt1).toHaveLength(2);
      expect(attempt1.map((m) => m.id)).toEqual(["msg-a1", "msg-a1b"]);

      const attempt2 = service.getHistory("proj-1", taskId, 2);
      expect(attempt2).toHaveLength(1);
      expect(attempt2[0].id).toBe("msg-a2");
    });

    it("returns empty array when no log file exists", () => {
      expect(service.getHistory("proj-1", "nonexistent")).toEqual([]);
    });

    it("skips malformed JSON lines gracefully", () => {
      const taskId = "os-malformed";
      const logPath = path.join(tmpDir, taskId, "chat-log.jsonl");
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(
        logPath,
        '{"id":"good","timestamp":"2026-03-25T10:00:00.000Z","role":"user","content":"OK","attempt":1}\n' +
          "NOT JSON\n" +
          '{"id":"also-good","timestamp":"2026-03-25T10:01:00.000Z","role":"assistant","content":"Reply","attempt":1}\n',
        "utf-8"
      );

      const history = service.getHistory("proj-1", taskId);
      expect(history).toHaveLength(2);
      expect(history.map((m) => m.id)).toEqual(["good", "also-good"]);
    });

    it("handles empty file gracefully", () => {
      const taskId = "os-empty";
      const logPath = path.join(tmpDir, taskId, "chat-log.jsonl");
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, "", "utf-8");

      expect(service.getHistory("proj-1", taskId)).toEqual([]);
    });

    it("creates directory structure when appending to new task", () => {
      const taskId = "os-newdir";
      service.appendMessage(taskId, {
        id: "msg-1",
        timestamp: "2026-03-25T10:00:00.000Z",
        role: "user",
        content: "Hello",
        attempt: 1,
      });

      const logPath = path.join(tmpDir, taskId, "chat-log.jsonl");
      expect(fs.existsSync(logPath)).toBe(true);
    });
  });

  describe("supportsChat", () => {
    it("returns supported=true for claude (API backend)", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "claude");

      const result = service.supportsChat("task-1");
      expect(result).toEqual({
        supported: true,
        backend: "claude",
        reason: null,
      });
    });

    it("returns supported=true for openai (API backend)", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "openai");

      const result = service.supportsChat("task-1");
      expect(result).toEqual({
        supported: true,
        backend: "openai",
        reason: null,
      });
    });

    it("returns supported=true for google (API backend)", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "google");

      const result = service.supportsChat("task-1");
      expect(result).toEqual({
        supported: true,
        backend: "google",
        reason: null,
      });
    });

    it("returns supported=true for lmstudio (API backend)", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "lmstudio");

      const result = service.supportsChat("task-1");
      expect(result).toEqual({
        supported: true,
        backend: "lmstudio",
        reason: null,
      });
    });

    it("returns supported=true for ollama (API backend)", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "ollama");

      const result = service.supportsChat("task-1");
      expect(result).toEqual({
        supported: true,
        backend: "ollama",
        reason: null,
      });
    });

    it("returns supported=false for claude-cli (CLI backend)", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "claude-cli");

      const result = service.supportsChat("task-1");
      expect(result).toEqual({
        supported: false,
        backend: "claude-cli",
        reason:
          "Chat is not available for CLI-based agent backends. Switch to API mode (Project Settings → Agent Config) to chat with running agents.",
      });
    });

    it("returns supported=false for cursor (CLI backend)", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "cursor");

      const result = service.supportsChat("task-1");
      expect(result).toEqual({
        supported: false,
        backend: "cursor",
        reason:
          "Chat is not available for CLI-based agent backends. Switch to API mode (Project Settings → Agent Config) to chat with running agents.",
      });
    });

    it("returns supported=false for custom (CLI backend)", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "custom");

      const result = service.supportsChat("task-1");
      expect(result).toEqual({
        supported: false,
        backend: "custom",
        reason:
          "Chat is not available for CLI-based agent backends. Switch to API mode (Project Settings → Agent Config) to chat with running agents.",
      });
    });

    it("returns supported=false with reason when no active agent", () => {
      const result = service.supportsChat("nonexistent-task");
      expect(result).toEqual({
        supported: false,
        backend: null,
        reason: "No active agent found for this task.",
      });
    });

    it("returns supported=false for unknown backend type", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "unknown-backend");

      const result = service.supportsChat("task-1");
      expect(result.supported).toBe(false);
      expect(result.backend).toBe("unknown-backend");
      expect(result.reason).toContain("Unknown agent backend");
    });
  });

  describe("sendMessage", () => {
    it("delivers message to API backend and persists it", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "claude");

      const result = service.sendMessage("proj-1", "task-1", "Fix the bug");
      expect(result.delivered).toBe(true);
      expect(result.messageId).toMatch(/^msg-/);
      expect(result.timestamp).toBeTruthy();
      expect(result.error).toBeUndefined();

      expect(queue.size).toBe(1);
      const drained = queue.drain();
      expect(drained[0].message).toBe("Fix the bug");

      const history = service.getHistory("proj-1", "task-1");
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe("user");
      expect(history[0].content).toBe("Fix the bug");
    });

    it("rejects with structured error for CLI backends", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "claude-cli");

      const result = service.sendMessage("proj-1", "task-1", "Hello");
      expect(result.delivered).toBe(false);
      expect(result.error).toContain("CLI-based agent backends");
      expect(result.messageId).toBe("");
      expect(queue.size).toBe(0);
    });

    it("rejects when no active agent exists", () => {
      const result = service.sendMessage("proj-1", "nonexistent", "Hello");
      expect(result.delivered).toBe(false);
      expect(result.error).toContain("No active agent");
      expect(result.messageId).toBe("");
    });

    it("returns error when queue is full", () => {
      const queue = new PendingMessageQueue(2);
      activeAgents.registerChannel("task-1", queue, "openai");

      queue.push("msg-1");
      queue.push("msg-2");

      const result = service.sendMessage("proj-1", "task-1", "This should fail");
      expect(result.delivered).toBe(false);
      expect(result.messageId).toMatch(/^msg-/);
      expect(result.error).toContain("Too many pending messages");

      const history = service.getHistory("proj-1", "task-1");
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe("This should fail");
    });

    it("uses provided attempt number", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "claude");

      service.sendMessage("proj-1", "task-1", "Retry message", 3);

      const history = service.getHistory("proj-1", "task-1");
      expect(history).toHaveLength(1);
      expect(history[0].attempt).toBe(3);
    });

    it("delivers multiple messages in order", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "openai");

      service.sendMessage("proj-1", "task-1", "First");
      service.sendMessage("proj-1", "task-1", "Second");
      service.sendMessage("proj-1", "task-1", "Third");

      const drained = queue.drain();
      expect(drained.map((d) => d.message)).toEqual(["First", "Second", "Third"]);

      const history = service.getHistory("proj-1", "task-1");
      expect(history.map((m) => m.content)).toEqual(["First", "Second", "Third"]);
    });
  });

  describe("appendAssistantMessage", () => {
    it("records an assistant response in the chat log", () => {
      const msg = service.appendAssistantMessage("task-1", "I will fix the bug now.", 1);

      expect(msg.role).toBe("assistant");
      expect(msg.content).toBe("I will fix the bug now.");
      expect(msg.attempt).toBe(1);
      expect(msg.id).toMatch(/^msg-/);

      const history = service.getHistory("proj-1", "task-1");
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(msg);
    });

    it("interleaves with user messages correctly", () => {
      const queue = new PendingMessageQueue();
      activeAgents.registerChannel("task-1", queue, "claude");

      service.sendMessage("proj-1", "task-1", "Fix tests");
      service.appendAssistantMessage("task-1", "Working on it.", 1);
      service.sendMessage("proj-1", "task-1", "Also fix lint");
      service.appendAssistantMessage("task-1", "Done with both.", 1);

      const history = service.getHistory("proj-1", "task-1");
      expect(history).toHaveLength(4);
      expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
      expect(history.map((m) => m.content)).toEqual([
        "Fix tests",
        "Working on it.",
        "Also fix lint",
        "Done with both.",
      ]);
    });
  });

  describe("supportsChat matrix — all backends", () => {
    const apiBackends = ["claude", "openai", "google", "lmstudio", "ollama"];
    const cliBackends = ["claude-cli", "cursor", "custom"];

    for (const backend of apiBackends) {
      it(`${backend} is supported`, () => {
        const queue = new PendingMessageQueue();
        activeAgents.registerChannel("task-matrix", queue, backend);
        const result = service.supportsChat("task-matrix");
        expect(result.supported).toBe(true);
        expect(result.backend).toBe(backend);
        expect(result.reason).toBeNull();
        activeAgents.unregister("task-matrix");
      });
    }

    for (const backend of cliBackends) {
      it(`${backend} is NOT supported`, () => {
        const queue = new PendingMessageQueue();
        activeAgents.registerChannel("task-matrix", queue, backend);
        const result = service.supportsChat("task-matrix");
        expect(result.supported).toBe(false);
        expect(result.backend).toBe(backend);
        expect(result.reason).toBeTruthy();
        activeAgents.unregister("task-matrix");
      });
    }
  });

  describe("JSONL file format", () => {
    it("writes one JSON object per line", () => {
      const taskId = "os-format";
      service.appendMessage(taskId, {
        id: "msg-1",
        timestamp: "2026-03-25T10:00:00.000Z",
        role: "user",
        content: "Line 1",
        attempt: 1,
      });
      service.appendMessage(taskId, {
        id: "msg-2",
        timestamp: "2026-03-25T10:00:01.000Z",
        role: "assistant",
        content: "Line 2",
        attempt: 1,
      });

      const logPath = path.join(tmpDir, taskId, "chat-log.jsonl");
      const raw = fs.readFileSync(logPath, "utf-8");
      const lines = raw.split("\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);

      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it("handles content with newlines without breaking JSONL format", () => {
      const taskId = "os-newlines";
      service.appendMessage(taskId, {
        id: "msg-1",
        timestamp: "2026-03-25T10:00:00.000Z",
        role: "user",
        content: "Line one\nLine two\nLine three",
        attempt: 1,
      });

      const history = service.getHistory("proj-1", taskId);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe("Line one\nLine two\nLine three");
    });
  });
});
