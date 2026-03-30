/**
 * AgentChatService — persists chat messages to JSONL and routes live messages
 * to the agentic loop's pending-messages channel via ActiveAgentsService.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { AgentType } from "@opensprint/shared";
import {
  ActiveAgentsService,
  activeAgentsService as defaultActiveAgentsService,
} from "./active-agents.service.js";

export interface ChatMessage {
  id: string;
  timestamp: string;
  role: "user" | "assistant";
  content: string;
  attempt: number;
}

export interface SupportsChatResult {
  supported: boolean;
  backend: string | null;
  reason: string | null;
}

export interface SendMessageResult {
  messageId: string;
  timestamp: string;
  delivered: boolean;
  error?: string;
}

const CLI_BACKENDS: ReadonlySet<AgentType> = new Set(["claude-cli", "cursor", "custom"]);

const API_BACKENDS: ReadonlySet<AgentType> = new Set([
  "claude",
  "openai",
  "google",
  "lmstudio",
  "ollama",
]);

const UNSUPPORTED_REASON =
  "Chat is not available for CLI-based agent backends. Switch to API mode (Project Settings → Agent Config) to chat with running agents.";

export class AgentChatService {
  constructor(
    private activeAgents: ActiveAgentsService = defaultActiveAgentsService,
    private basePath?: string
  ) {}

  private chatLogPath(taskId: string): string {
    const base = this.basePath ?? path.join(process.cwd(), ".opensprint", "active");
    return path.join(base, taskId, "chat-log.jsonl");
  }

  /**
   * Append a chat message to the JSONL log.
   * Creates the directory if it doesn't exist.
   */
  appendMessage(taskId: string, message: ChatMessage): void {
    const logPath = this.chatLogPath(taskId);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(message) + "\n", "utf-8");
  }

  /**
   * Read chat history from the JSONL log, optionally filtered by attempt.
   */
  getHistory(_projectId: string, taskId: string, attempt?: number): ChatMessage[] {
    const logPath = this.chatLogPath(taskId);
    if (!fs.existsSync(logPath)) return [];

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const messages: ChatMessage[] = [];

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as ChatMessage;
        if (attempt !== undefined && msg.attempt !== attempt) continue;
        messages.push(msg);
      } catch {
        // skip malformed lines
      }
    }

    return messages;
  }

  /**
   * Check if the active agent for a task supports live chat.
   * Returns a structured result with the backend type and reason when unsupported.
   */
  supportsChat(taskId: string): SupportsChatResult {
    const channel = this.activeAgents.getChannel(taskId);

    if (!channel) {
      return {
        supported: false,
        backend: null,
        reason: "No active agent found for this task.",
      };
    }

    const backendType = channel.backendType as AgentType;

    if (CLI_BACKENDS.has(backendType)) {
      return {
        supported: false,
        backend: backendType,
        reason: UNSUPPORTED_REASON,
      };
    }

    if (API_BACKENDS.has(backendType)) {
      return {
        supported: true,
        backend: backendType,
        reason: null,
      };
    }

    return {
      supported: false,
      backend: backendType,
      reason: `Unknown agent backend: ${backendType}`,
    };
  }

  /**
   * Send a user message to the active agent for a task.
   *
   * - Validates the agent is active and uses an API backend.
   * - Persists the message to chat-log.jsonl.
   * - Pushes to the agentic loop's pending-messages channel.
   * - Returns delivery status.
   */
  sendMessage(
    projectId: string,
    taskId: string,
    content: string,
    attempt: number = 1
  ): SendMessageResult {
    const chatSupport = this.supportsChat(taskId);

    if (!chatSupport.supported) {
      return {
        messageId: "",
        timestamp: new Date().toISOString(),
        delivered: false,
        error: chatSupport.reason ?? "Chat not supported",
      };
    }

    const channel = this.activeAgents.getChannel(taskId);
    if (!channel) {
      return {
        messageId: "",
        timestamp: new Date().toISOString(),
        delivered: false,
        error: "No active agent found for this task.",
      };
    }

    const messageId = `msg-${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();

    const message: ChatMessage = {
      id: messageId,
      timestamp,
      role: "user",
      content,
      attempt,
    };

    this.appendMessage(taskId, message);

    const accepted = channel.pendingMessages.push(content);

    if (!accepted) {
      return {
        messageId,
        timestamp,
        delivered: false,
        error: "Too many pending messages — wait for the agent to respond.",
      };
    }

    return {
      messageId,
      timestamp,
      delivered: true,
    };
  }

  /**
   * Record an assistant response in the chat log.
   * Called by the agentic loop (or its callback) when the agent produces a chat reply.
   */
  appendAssistantMessage(taskId: string, content: string, attempt: number = 1): ChatMessage {
    const message: ChatMessage = {
      id: `msg-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      role: "assistant",
      content,
      attempt,
    };
    this.appendMessage(taskId, message);
    return message;
  }
}

export const agentChatService = new AgentChatService();
