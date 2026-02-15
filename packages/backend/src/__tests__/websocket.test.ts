import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "http";
import { WebSocket } from "ws";
import {
  setupWebSocket,
  closeWebSocket,
  broadcastToProject,
  sendAgentOutput,
} from "../websocket/index.js";

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

  it("accepts connections to /ws/projects/:id", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-123`);
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
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
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
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-456`);
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
      assignee: "agent-1",
    });
    await msgPromise;
    await waitForClose(ws);
  });

  it("sends agent output to subscribed clients", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-789`);
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
    sendAgentOutput("task-abc", "Hello from agent");
    await msgPromise;
    await waitForClose(ws);
  });

  it("handles agent.unsubscribe", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-sub`);
    let receivedOutput = false;
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString());
      if (event.type === "agent.output") receivedOutput = true;
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.send(JSON.stringify({ type: "agent.subscribe", taskId: "task-x" }));
    ws.send(JSON.stringify({ type: "agent.unsubscribe", taskId: "task-x" }));
    await new Promise((r) => setTimeout(r, 30));
    sendAgentOutput("task-x", "Should not be received");
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    await waitForClose(ws);
    expect(receivedOutput).toBe(false);
  });

  it("ignores malformed JSON messages without crashing", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/projects/proj-malformed`);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.send("not valid json");
    ws.send("{");
    await new Promise((r) => setTimeout(r, 30));
    ws.close();
    await waitForClose(ws);
  });
});
