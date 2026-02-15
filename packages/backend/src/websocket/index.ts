import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { ServerEvent, ClientEvent } from "@opensprint/shared";
import { hilService } from "../services/hil-service.js";

/** Map of projectId → Set of connected clients */
const projectClients = new Map<string, Set<WebSocket>>();

/** Map of WebSocket → subscribed task IDs */
const agentSubscriptions = new Map<WebSocket, Set<string>>();

let wss: WebSocketServer;

export function setupWebSocket(server: Server): void {
  // No path filter — we accept /ws and /ws/projects/:id; path matching is done in the handler
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    // Extract projectId from URL: /ws/projects/:id (PRD §11.2)
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const path = url.pathname;
    const match = path.match(/^\/ws\/projects\/([^/]+)$/);
    const projectId = match?.[1];

    // Reject connections that don't match expected paths
    if (path !== "/ws" && !match) {
      ws.close(1008, "Invalid path: use /ws or /ws/projects/:id");
      return;
    }

    if (!projectId) {
      // Bare /ws connections accepted but not project-scoped
      console.log("[WS] Client connected (no project scope)");
    } else {
      console.log(`[WS] Client connected to project ${projectId}`);
      if (!projectClients.has(projectId)) {
        projectClients.set(projectId, new Set());
      }
      projectClients.get(projectId)!.add(ws);
    }

    agentSubscriptions.set(ws, new Set());

    ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString()) as ClientEvent;
        handleClientEvent(ws, event);
      } catch (err) {
        console.error("[WS] Invalid message:", err);
      }
    });

    ws.on("close", () => {
      // Clean up subscriptions
      agentSubscriptions.delete(ws);

      // Clean up project client tracking
      if (projectId) {
        projectClients.get(projectId)?.delete(ws);
        if (projectClients.get(projectId)?.size === 0) {
          projectClients.delete(projectId);
        }
      }
      console.log("[WS] Client disconnected");
    });
  });
}

function handleClientEvent(ws: WebSocket, event: ClientEvent): void {
  if (!event || typeof event !== "object" || !event.type) {
    console.warn("[WS] Ignoring malformed client event");
    return;
  }
  switch (event.type) {
    case "agent.subscribe": {
      if ("taskId" in event && event.taskId) {
        agentSubscriptions.get(ws)?.add(event.taskId);
        console.log(`[WS] Client subscribed to agent output for task ${event.taskId}`);
      }
      break;
    }
    case "agent.unsubscribe": {
      if ("taskId" in event && event.taskId) {
        agentSubscriptions.get(ws)?.delete(event.taskId);
        console.log(`[WS] Client unsubscribed from agent output for task ${event.taskId}`);
      }
      break;
    }
    case "hil.respond": {
      if ("requestId" in event && event.requestId) {
        hilService.respondToRequest(event.requestId, event.approved, event.notes);
      }
      break;
    }
    default:
      console.warn(`[WS] Unknown client event type: ${(event as { type?: string }).type}`);
  }
}

/** Broadcast an event to all clients connected to a project */
export function broadcastToProject(projectId: string, event: ServerEvent): void {
  const clients = projectClients.get(projectId);
  if (!clients) return;

  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

/** Close all WebSocket connections and the server (for graceful shutdown) */
export function closeWebSocket(): void {
  if (!wss) return;
  for (const ws of agentSubscriptions.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
  projectClients.clear();
  agentSubscriptions.clear();
  wss.close();
}

/** Send agent output to clients subscribed to a specific task */
export function sendAgentOutput(taskId: string, chunk: string): void {
  const event: ServerEvent = { type: "agent.output", taskId, chunk };
  const data = JSON.stringify(event);

  for (const [ws, subscriptions] of agentSubscriptions) {
    if (subscriptions.has(taskId) && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}
