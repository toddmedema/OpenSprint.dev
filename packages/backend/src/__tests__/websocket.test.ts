import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "http";
import { WebSocket } from "ws";
import {
  setupWebSocket,
  closeWebSocket,
  broadcastToProject,
  sendAgentOutputToProject,
  sendAgentChatResponse,
} from "../websocket/index.js";
import { AgentChatService } from "../services/agent-chat.service.js";
import { ActiveAgentsService } from "../services/active-agents.service.js";
import { VITEST_DEFAULT_LOCAL_SESSION_TOKEN } from "../services/local-session-auth.service.js";

const WS_AUTH = { headers: { Authorization: `Bearer ${VITEST_DEFAULT_LOCAL_SESSION_TOKEN}` } };

vi.mock("../services/hil-service.js", () => ({
  hilService: {
    respondToRequest: vi.fn(),
  },
}));

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.on("close", () => resolve());
  });
}

describe("WebSocket server and connection handling", () => {
  let server: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(() => {
    server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    setupWebSocket(server);
    return new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 31999;
        resolve();
      });
    });
  });

  afterEach(async () => {
    closeWebSocket();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await new Promise((r) => setTimeout(r, 50)); // Allow sockets to fully close
  });

  it("rejects connections without session credentials", async () => {
    await expect(
      Promise.race([
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${port}/ws`);
          ws.on("open", () => reject(new Error("unexpected open without credentials")));
          ws.on("error", () => resolve());
        }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("handshake timeout")), 5000)
        ),
      ])
    ).resolves.toBeUndefined();
  });

  it("rejects connections with invalid bearer token", async () => {
    await expect(
      Promise.race([
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${port}/ws`, {
            headers: { Authorization: "Bearer wrong-token" },
          });
          ws.on("open", () => reject(new Error("unexpected open with bad token")));
          ws.on("error", () => resolve());
        }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("handshake timeout")), 5000)
        ),
      ])
    ).resolves.toBeUndefined();
  });

  it("accepts connections with token query parameter", async () => {
    const q = new URLSearchParams({
      token: VITEST_DEFAULT_LOCAL_SESSION_TOKEN,
    });
    const ws = new WebSocket(`ws://localhost:${port}/ws?${q.toString()}`);
    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        resolve();
      });
    });
    await waitForClose(ws);
  });

  it("accepts connections to /ws/projects/:id", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-123`, WS_AUTH);
    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        resolve();
      });
    });
    await waitForClose(ws);
  });

  it("accepts connections to bare /ws", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`, WS_AUTH);
    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        resolve();
      });
    });
    await waitForClose(ws);
  });

  it("broadcasts events to project-scoped clients", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-456`, WS_AUTH);
    const msgPromise = new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString());
        expect(event.type).toBe("task.updated");
        expect(event.taskId).toBe("task-1");
        expect(event.status).toBe("in_progress");
        ws.close();
        resolve();
      });
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    broadcastToProject("proj-456", {
      type: "task.updated",
      taskId: "task-1",
      status: "in_progress",
      assignee: "Frodo",
    });
    await msgPromise;
    await waitForClose(ws);
  });

  it("sends agent output to subscribed clients", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-789`, WS_AUTH);
    const msgPromise = new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString());
        if (event.type === "agent.output") {
          expect(event.taskId).toBe("task-abc");
          expect(event.chunk).toBe("Hello from agent");
          ws.close();
          resolve();
        }
      });
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.send(JSON.stringify({ type: "agent.subscribe", taskId: "task-abc" }));
    await new Promise((r) => setTimeout(r, 30));
    sendAgentOutputToProject("proj-789", "task-abc", "Hello from agent");
    await msgPromise;
    await waitForClose(ws);
  });

  it("handles agent.unsubscribe", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-sub`, WS_AUTH);
    let receivedOutput = false;
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString());
      if (event.type === "agent.output") receivedOutput = true;
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.send(JSON.stringify({ type: "agent.subscribe", taskId: "task-x" }));
    ws.send(JSON.stringify({ type: "agent.unsubscribe", taskId: "task-x" }));
    await new Promise((r) => setTimeout(r, 30));
    sendAgentOutputToProject("proj-sub", "task-x", "Should not be received");
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    await waitForClose(ws);
    expect(receivedOutput).toBe(false);
  });

  it("ignores malformed JSON messages without crashing", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-malformed`, WS_AUTH);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.send("not valid json");
    ws.send("{");
    await new Promise((r) => setTimeout(r, 30));
    ws.close();
    await waitForClose(ws);
  });
});

describe("WebSocket agent.subscribe backfill ordering", () => {
  let server: ReturnType<typeof createServer>;
  let port: number;

  afterEach(async () => {
    closeWebSocket();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await new Promise((r) => setTimeout(r, 50));
  });

  it("sends backfill before registering subscription so live chunks don't overlap", async () => {
    const getLiveOutput = vi.fn().mockResolvedValue("backfill-content");
    server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    setupWebSocket(server, { getLiveOutput });
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 31999;
        resolve();
      });
    });

    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-backfill`, WS_AUTH);
    const events: Record<string, unknown>[] = [];
    ws.on("message", (data) => {
      events.push(JSON.parse(data.toString()));
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    ws.send(JSON.stringify({ type: "agent.subscribe", taskId: "task-bf" }));
    // Wait for the async getLiveOutput to resolve and backfill to be sent
    await new Promise((r) => setTimeout(r, 100));

    expect(getLiveOutput).toHaveBeenCalledWith("proj-backfill", "task-bf");
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      type: "agent.outputBackfill",
      taskId: "task-bf",
      output: "backfill-content",
    });

    // Now that the subscription is registered (after backfill), live output should arrive
    sendAgentOutputToProject("proj-backfill", "task-bf", "live-chunk");
    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBe(2);
    expect(events[1]).toMatchObject({ type: "agent.output", chunk: "live-chunk" });

    ws.close();
    await waitForClose(ws);
  });

  it("registers subscription even when getLiveOutput rejects", async () => {
    const getLiveOutput = vi.fn().mockRejectedValue(new Error("boom"));
    server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    setupWebSocket(server, { getLiveOutput });
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 31999;
        resolve();
      });
    });

    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-err`, WS_AUTH);
    const events: Record<string, unknown>[] = [];
    ws.on("message", (data) => {
      events.push(JSON.parse(data.toString()));
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    ws.send(JSON.stringify({ type: "agent.subscribe", taskId: "task-err" }));
    await new Promise((r) => setTimeout(r, 100));

    // No backfill sent (error), but subscription should still be registered
    expect(events.length).toBe(0);
    sendAgentOutputToProject("proj-err", "task-err", "after-error");
    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ type: "agent.output", chunk: "after-error" });

    ws.close();
    await waitForClose(ws);
  });
});

describe("WebSocket agent.chat event handling", () => {
  let server: ReturnType<typeof createServer>;
  let port: number;
  let activeAgents: ActiveAgentsService;
  let chatSvc: AgentChatService;

  function makePendingQueue(maxSize = 10) {
    const items: string[] = [];
    return {
      push(msg: string): boolean {
        if (items.length >= maxSize) return false;
        items.push(msg);
        return true;
      },
      items,
    };
  }

  beforeEach(() => {
    activeAgents = new ActiveAgentsService();
    chatSvc = new AgentChatService(activeAgents, "/tmp/test-chat-" + Date.now());

    server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    setupWebSocket(server, { agentChatService: chatSvc });
    return new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 31999;
        resolve();
      });
    });
  });

  afterEach(async () => {
    closeWebSocket();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await new Promise((r) => setTimeout(r, 50));
  });

  it("broadcasts agent.chat.received when message is delivered to API backend", async () => {
    const queue = makePendingQueue();
    activeAgents.registerChannel("task-1", queue, "openai");

    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-chat`, WS_AUTH);
    const msgPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString());
        if (event.type === "agent.chat.received") resolve(event);
      });
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    ws.send(JSON.stringify({ type: "agent.chat.send", taskId: "task-1", message: "hello agent" }));
    const received = await msgPromise;

    expect(received.type).toBe("agent.chat.received");
    expect(received.taskId).toBe("task-1");
    expect(received.messageId).toBeTruthy();
    expect(received.timestamp).toBeTruthy();
    expect(queue.items).toContain("hello agent");

    ws.close();
    await waitForClose(ws);
  });

  it("broadcasts agent.chat.unsupported for CLI backends", async () => {
    const queue = makePendingQueue();
    activeAgents.registerChannel("task-cli", queue, "claude-cli");

    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-chat-cli`, WS_AUTH);
    const msgPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString());
        if (event.type === "agent.chat.unsupported") resolve(event);
      });
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    ws.send(JSON.stringify({ type: "agent.chat.send", taskId: "task-cli", message: "hello" }));
    const unsupported = await msgPromise;

    expect(unsupported.type).toBe("agent.chat.unsupported");
    expect(unsupported.taskId).toBe("task-cli");
    expect(typeof unsupported.reason).toBe("string");
    expect(queue.items).toHaveLength(0);

    ws.close();
    await waitForClose(ws);
  });

  it("broadcasts agent.chat.unsupported when no active agent exists", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-chat-none`, WS_AUTH);
    const msgPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString());
        if (event.type === "agent.chat.unsupported") resolve(event);
      });
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    ws.send(JSON.stringify({ type: "agent.chat.send", taskId: "task-ghost", message: "hello" }));
    const unsupported = await msgPromise;

    expect(unsupported.type).toBe("agent.chat.unsupported");
    expect(unsupported.taskId).toBe("task-ghost");
    expect(unsupported.reason).toMatch(/no active agent/i);

    ws.close();
    await waitForClose(ws);
  });

  it("broadcasts agent.chat.unsupported when pending queue is full", async () => {
    const queue = makePendingQueue(0);
    activeAgents.registerChannel("task-full", queue, "claude");

    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-chat-full`, WS_AUTH);
    const msgPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString());
        if (event.type === "agent.chat.unsupported") resolve(event);
      });
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    ws.send(JSON.stringify({ type: "agent.chat.send", taskId: "task-full", message: "hello" }));
    const unsupported = await msgPromise;

    expect(unsupported.type).toBe("agent.chat.unsupported");
    expect(unsupported.taskId).toBe("task-full");
    expect(unsupported.reason).toMatch(/pending/i);

    ws.close();
    await waitForClose(ws);
  });

  it("silently ignores agent.chat.send from unscoped /ws clients", async () => {
    const queue = makePendingQueue();
    activeAgents.registerChannel("task-2", queue, "openai");

    const ws = new WebSocket(`ws://localhost:${port}/ws`, WS_AUTH);
    const messages: Record<string, unknown>[] = [];
    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()));
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    ws.send(JSON.stringify({ type: "agent.chat.send", taskId: "task-2", message: "hello" }));
    await new Promise((r) => setTimeout(r, 100));

    expect(messages).toHaveLength(0);
    expect(queue.items).toHaveLength(0);

    ws.close();
    await waitForClose(ws);
  });

  it("silently ignores agent.chat.send with missing taskId or message", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-chat-bad`, WS_AUTH);
    const messages: Record<string, unknown>[] = [];
    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()));
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    ws.send(JSON.stringify({ type: "agent.chat.send", taskId: "", message: "hello" }));
    ws.send(JSON.stringify({ type: "agent.chat.send", taskId: "task-1" }));
    ws.send(JSON.stringify({ type: "agent.chat.send" }));
    await new Promise((r) => setTimeout(r, 100));

    expect(messages).toHaveLength(0);

    ws.close();
    await waitForClose(ws);
  });

  it("sendAgentChatResponse broadcasts agent.chat.response to project clients", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-chat-resp`, WS_AUTH);
    const msgPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString());
        if (event.type === "agent.chat.response") resolve(event);
      });
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    sendAgentChatResponse("proj-chat-resp", "task-3", "msg-abc", "Here is my response");
    const response = await msgPromise;

    expect(response.type).toBe("agent.chat.response");
    expect(response.taskId).toBe("task-3");
    expect(response.messageId).toBe("msg-abc");
    expect(response.content).toBe("Here is my response");

    ws.close();
    await waitForClose(ws);
  });

  it("delivers chat to multiple project-scoped clients", async () => {
    const queue = makePendingQueue();
    activeAgents.registerChannel("task-multi", queue, "google");

    const ws1 = new WebSocket(`ws://localhost:${port}/ws/projects/proj-multi`, WS_AUTH);
    const ws2 = new WebSocket(`ws://localhost:${port}/ws/projects/proj-multi`, WS_AUTH);
    await Promise.all([
      new Promise<void>((resolve) => ws1.on("open", () => resolve())),
      new Promise<void>((resolve) => ws2.on("open", () => resolve())),
    ]);

    const collectFrom = (ws: WebSocket) =>
      new Promise<Record<string, unknown>>((resolve) => {
        ws.on("message", (data) => {
          const event = JSON.parse(data.toString());
          if (event.type === "agent.chat.received") resolve(event);
        });
      });
    const p1 = collectFrom(ws1);
    const p2 = collectFrom(ws2);

    ws1.send(
      JSON.stringify({ type: "agent.chat.send", taskId: "task-multi", message: "hello all" })
    );
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.type).toBe("agent.chat.received");
    expect(r2.type).toBe("agent.chat.received");
    expect(r1.messageId).toBe(r2.messageId);

    ws1.close();
    ws2.close();
    await Promise.all([waitForClose(ws1), waitForClose(ws2)]);
  });
});
