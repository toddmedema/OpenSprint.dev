import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "http";
import type {
  ServerEvent,
  ClientEvent,
  AgentOutputBackfillEvent,
  PlanAgentOutputBackfillEvent,
  AgentChatReceivedEvent,
  AgentChatResponseEvent,
  AgentChatUnsupportedEvent,
} from "@opensprint/shared";
import { eventRelay } from "../services/event-relay.service.js";
import { getPlanAgentOutput } from "../services/plan-agent-output-buffer.service.js";
import { createLogger } from "../utils/logger.js";
import {
  AgentChatService,
  agentChatService as defaultAgentChatService,
} from "../services/agent-chat.service.js";
import {
  isValidLocalSessionToken,
  requestHasValidBearerToken,
} from "../services/local-session-auth.service.js";

const log = createLogger("websocket");

/** WebSocket upgrade must present the same Bearer session as mutating HTTP routes (header or `token` query). */
function webSocketUpgradeAuthenticated(req: IncomingMessage, url: URL): boolean {
  if (requestHasValidBearerToken(req.headers.authorization)) return true;
  const q = url.searchParams.get("token");
  return isValidLocalSessionToken(q);
}

function verifyWebSocketUpgrade(info: { req: IncomingMessage }): boolean {
  const req = info.req;
  let url: URL;
  try {
    url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  } catch {
    return false;
  }
  const pathname = url.pathname;
  const match = pathname.match(/^\/ws\/projects\/([^/]+)$/);
  if (pathname !== "/ws" && !match) {
    return false;
  }
  return webSocketUpgradeAuthenticated(req, url);
}

/** Map of projectId → Set of connected clients */
const projectClients = new Map<string, Set<WebSocket>>();

/** Map of WebSocket → subscribed task IDs */
const agentSubscriptions = new Map<WebSocket, Set<string>>();

/** Map of WebSocket → subscribed plan IDs (for Auditor output) */
const planAgentSubscriptions = new Map<WebSocket, Set<string>>();

/** Map of WebSocket → projectId (only set when client connected to /ws/projects/:id) */
const wsToProjectId = new Map<WebSocket, string>();

let getLiveOutput: ((projectId: string, taskId: string) => Promise<string>) | null = null;
let chatService: AgentChatService = defaultAgentChatService;

let wss: WebSocketServer;
let clientHasConnected = false;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
const HEARTBEAT_INTERVAL_MS = 30_000;
const wsAlive = new WeakMap<WebSocket, boolean>();

/** Whether any WebSocket client has connected since this server booted. */
export function hasClientConnected(): boolean {
  return clientHasConnected;
}

export interface WebSocketOptions {
  getLiveOutput?: (projectId: string, taskId: string) => Promise<string>;
  agentChatService?: AgentChatService;
}

export function setupWebSocket(server: Server, options?: WebSocketOptions): void {
  getLiveOutput = options?.getLiveOutput ?? null;
  chatService = options?.agentChatService ?? defaultAgentChatService;
  eventRelay.init(projectClients, agentSubscriptions, planAgentSubscriptions);

  wss = new WebSocketServer({ server, verifyClient: verifyWebSocketUpgrade });

  wss.on("connection", (ws, req) => {
    // Extract projectId from URL: /ws/projects/:id (PRD §11.2)
    const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const match = path.match(/^\/ws\/projects\/([^/]+)$/);
    const projectId = match?.[1];

    clientHasConnected = true;
    wsAlive.set(ws, true);

    if (!projectId) {
      log.info("Client connected (no project scope)");
    } else {
      log.info("Client connected to project", { projectId });
      wsToProjectId.set(ws, projectId);
      if (!projectClients.has(projectId)) {
        projectClients.set(projectId, new Set());
      }
      projectClients.get(projectId)!.add(ws);
    }

    agentSubscriptions.set(ws, new Set());
    planAgentSubscriptions.set(ws, new Set());

    ws.on("pong", () => {
      wsAlive.set(ws, true);
    });

    ws.on("message", (data) => {
      try {
        const parsed: unknown = JSON.parse(data.toString());
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as Record<string, unknown>).type === "string"
        ) {
          handleClientEvent(ws, parsed as ClientEvent);
        } else {
          log.warn("Ignoring non-object or type-less WebSocket message");
        }
      } catch (err) {
        log.error("Invalid message", { err });
      }
    });

    ws.on("close", () => {
      wsToProjectId.delete(ws);
      agentSubscriptions.delete(ws);
      planAgentSubscriptions.delete(ws);

      // Clean up project client tracking
      if (projectId) {
        projectClients.get(projectId)?.delete(ws);
        if (projectClients.get(projectId)?.size === 0) {
          projectClients.delete(projectId);
        }
      }
      log.info("Client disconnected");
    });
  });

  heartbeatInterval = setInterval(() => {
    for (const ws of agentSubscriptions.keys()) {
      if (wsAlive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      wsAlive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function handleClientEvent(ws: WebSocket, event: ClientEvent): void {
  if (!event || typeof event !== "object" || !event.type) {
    log.warn("Ignoring malformed client event");
    return;
  }
  switch (event.type) {
    case "agent.subscribe": {
      if ("taskId" in event && event.taskId) {
        const taskId = event.taskId;
        log.info("Client subscribed to agent output", { taskId });
        const projectId = wsToProjectId.get(ws);
        if (projectId && getLiveOutput && ws.readyState === 1 /* WebSocket.OPEN */) {
          // Send backfill BEFORE registering the subscription so that no
          // live agent.output events are delivered to this client until the
          // backfill (which already contains all prior output) has been sent.
          // This eliminates the window where the same tail text appears in
          // both the backfill and a live chunk, preventing duplicate output.
          getLiveOutput(projectId, taskId)
            .then((output) => {
              if (ws.readyState === 1) {
                if (output.length > 0) {
                  const backfill: AgentOutputBackfillEvent = {
                    type: "agent.outputBackfill",
                    taskId,
                    output,
                  };
                  try {
                    ws.send(JSON.stringify(backfill));
                  } catch (sendErr) {
                    log.debug("backfill send failed", { taskId, err: sendErr instanceof Error ? sendErr.message : String(sendErr) });
                  }
                }
                agentSubscriptions.get(ws)?.add(taskId);
              }
            })
            .catch((err) => {
              log.warn("getLiveOutput failed on subscribe", { taskId, err });
              agentSubscriptions.get(ws)?.add(taskId);
            });
        } else {
          agentSubscriptions.get(ws)?.add(taskId);
        }
      }
      break;
    }
    case "agent.unsubscribe": {
      if ("taskId" in event && event.taskId) {
        agentSubscriptions.get(ws)?.delete(event.taskId);
        log.info("Client unsubscribed from agent output", { taskId: event.taskId });
      }
      break;
    }
    case "plan.agent.subscribe": {
      if ("planId" in event && event.planId) {
        const planId = event.planId;
        planAgentSubscriptions.get(ws)?.add(planId);
        log.info("Client subscribed to plan agent output", { planId });
        const projectId = wsToProjectId.get(ws);
        if (projectId && ws.readyState === 1 /* WebSocket.OPEN */) {
          const output = getPlanAgentOutput(projectId, planId);
          if (output.length > 0) {
            const backfill: PlanAgentOutputBackfillEvent = {
              type: "plan.agent.outputBackfill",
              planId,
              output,
            };
            try {
              ws.send(JSON.stringify(backfill));
            } catch (sendErr) {
              log.debug("plan backfill send failed", { planId, err: sendErr instanceof Error ? sendErr.message : String(sendErr) });
            }
          }
        }
      }
      break;
    }
    case "plan.agent.unsubscribe": {
      if ("planId" in event && event.planId) {
        planAgentSubscriptions.get(ws)?.delete(event.planId);
        log.info("Client unsubscribed from plan agent output", { planId: event.planId });
      }
      break;
    }
    case "agent.chat.send": {
      if (!("taskId" in event) || !event.taskId || !("message" in event) || !event.message) {
        log.warn("agent.chat.send missing taskId or message");
        break;
      }
      const projectId = wsToProjectId.get(ws);
      if (!projectId) {
        log.warn("agent.chat.send from client without project scope");
        break;
      }
      const { taskId, message } = event;

      const support = chatService.supportsChat(taskId);
      if (!support.supported) {
        const unsupported: AgentChatUnsupportedEvent = {
          type: "agent.chat.unsupported",
          taskId,
          reason: support.reason ?? "Chat not supported",
        };
        broadcastToProject(projectId, unsupported);
        break;
      }

      const result = chatService.sendMessage(projectId, taskId, message);
      if (result.delivered) {
        const received: AgentChatReceivedEvent = {
          type: "agent.chat.received",
          taskId,
          messageId: result.messageId,
          timestamp: result.timestamp,
        };
        broadcastToProject(projectId, received);
      } else {
        const unsupported: AgentChatUnsupportedEvent = {
          type: "agent.chat.unsupported",
          taskId,
          reason: result.error ?? "Failed to deliver message",
        };
        broadcastToProject(projectId, unsupported);
      }
      break;
    }
    default:
      log.warn("Unknown client event type", { type: (event as { type?: string }).type });
  }
}

/** Broadcast an event to all clients connected to a project */
export function broadcastToProject(projectId: string, event: ServerEvent): void {
  eventRelay.broadcast(projectId, event);
}

/** Close all WebSocket connections and the server (for graceful shutdown) */
export function closeWebSocket(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (!wss) return;
  for (const ws of agentSubscriptions.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
  projectClients.clear();
  agentSubscriptions.clear();
  planAgentSubscriptions.clear();
  wss.close();
}

/** Send agent output to clients in a project who have subscribed to the task via agent.subscribe */
export function sendAgentOutputToProject(projectId: string, taskId: string, chunk: string): void {
  eventRelay.sendAgentOutputToProject(projectId, taskId, chunk);
}

/** Send plan agent output (Auditor) to clients subscribed via plan.agent.subscribe */
export function sendPlanAgentOutputToProject(
  projectId: string,
  planId: string,
  chunk: string
): void {
  eventRelay.sendPlanAgentOutputToProject(projectId, planId, chunk);
}

/** Broadcast an agent chat response to all project clients */
export function sendAgentChatResponse(
  projectId: string,
  taskId: string,
  messageId: string,
  content: string
): void {
  const event: AgentChatResponseEvent = {
    type: "agent.chat.response",
    taskId,
    messageId,
    content,
  };
  broadcastToProject(projectId, event);
}
