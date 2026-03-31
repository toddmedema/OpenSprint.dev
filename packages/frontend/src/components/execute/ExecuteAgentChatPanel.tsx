import { useState, useRef, useLayoutEffect, useCallback } from "react";
import { ChatInput } from "../ChatInput";
import { MarkdownChatBubble } from "../MarkdownChatBubble";
import { ChatIcon } from "../icons/PrdIcons";
import { loadTextDraft } from "../../lib/agentInputDraftStorage";
import { useOptimisticTextDraft } from "../../hooks/useOptimisticTextDraft";
import { useAutoScroll } from "../../hooks/useAutoScroll";

export interface ExecuteChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** True once the backend has acknowledged receipt. */
  delivered?: boolean;
}

export interface ExecuteAgentChatPanelProps {
  messages: ExecuteChatMessage[];
  sending: boolean;
  onSend: (message: string) => void | boolean | Promise<void | boolean>;
  /** When set, composer text is restored from localStorage and saved on change until a successful send clears it. */
  draftStorageKey?: string;
  /** Whether the agent is currently running. When false, the chat input is disabled. */
  agentRunning: boolean;
  /** Whether the current backend supports live chat (API backends only). CLI backends don't. */
  chatSupported: boolean;
  /** Reason chat is unsupported, shown as a notice. */
  chatUnsupportedReason?: string;
  /** Resets auto-scroll state when changed (e.g. task ID). */
  scrollResetKey?: string;
  /**
   * When this key changes and auto-scroll is enabled, scroll to bottom.
   * Useful for triggering scroll on tab/section visibility changes.
   */
  scrollTriggerKey?: string | number;
}

function ExecuteChatBubble({ msg }: { msg: ExecuteChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "border border-theme-border bg-theme-surface text-theme-text shadow-sm"
            : "bg-theme-border-subtle text-theme-text"
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">
            {msg.content}
            {msg.delivered && (
              <span
                className="ml-1.5 inline-block text-theme-muted text-xs align-middle"
                title="Delivered"
                data-testid="delivery-checkmark"
              >
                ✓
              </span>
            )}
          </span>
        ) : (
          <MarkdownChatBubble content={msg.content} />
        )}
      </div>
    </div>
  );
}

export function ExecuteAgentChatPanel({
  messages,
  sending,
  onSend,
  draftStorageKey,
  agentRunning,
  chatSupported,
  chatUnsupportedReason,
  scrollResetKey = "",
  scrollTriggerKey,
}: ExecuteAgentChatPanelProps) {
  const [chatInput, setChatInput] = useState(() =>
    draftStorageKey ? loadTextDraft(draftStorageKey) : ""
  );
  const { beginSend, onSuccess, onFailure } = useOptimisticTextDraft(
    draftStorageKey,
    chatInput,
    setChatInput
  );
  const [localSendBusy, setLocalSendBusy] = useState(false);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    containerRef: scrollContainerRef,
    showJumpToBottom: showChatJumpToBottom,
    jumpToBottom: chatJumpToBottom,
    handleScroll: handleChatScroll,
  } = useAutoScroll({
    contentLength: messages.length,
    resetKey: scrollResetKey,
    triggerKey: scrollTriggerKey,
  });

  useLayoutEffect(() => {
    setChatInput(draftStorageKey ? loadTextDraft(draftStorageKey) : "");
  }, [draftStorageKey]);

  const runSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || sending || localSendBusy) return;
    setLocalSendBusy(true);
    if (draftStorageKey) {
      beginSend(text);
    }
    try {
      const outcome = await Promise.resolve(onSend(text));
      if (outcome !== false) {
        onSuccess();
      } else {
        onFailure();
      }
    } catch {
      if (draftStorageKey) onFailure();
    } finally {
      setLocalSendBusy(false);
    }
  }, [chatInput, sending, localSendBusy, onSend, draftStorageKey, beginSend, onSuccess, onFailure]);

  const handleSend = useCallback(() => {
    void runSend();
  }, [runSend]);

  const inputDisabled = !agentRunning || !chatSupported;
  const sendDisabled = sending || localSendBusy || inputDisabled;

  const sendTooltip = !chatSupported
    ? "Chat is not available with CLI backends"
    : !agentRunning
      ? "Agent is not running"
      : sending || localSendBusy
        ? "Waiting for response…"
        : undefined;

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="execute-agent-chat-panel">
      {/* Unsupported notice */}
      {!chatSupported && (
        <div
          className="mx-4 mb-3 px-3 py-2.5 bg-theme-surface-muted border border-theme-border-subtle rounded-lg text-xs text-theme-muted"
          data-testid="chat-unsupported-notice"
        >
          {chatUnsupportedReason ??
            "Live chat is only available with API-based agent backends. CLI backends (Claude CLI, Cursor CLI, Custom CLI) do not support mid-flight messaging."}
        </div>
      )}

      {/* Not running notice */}
      {chatSupported && !agentRunning && (
        <div
          className="mx-4 mb-3 px-3 py-2.5 bg-theme-surface-muted border border-theme-border-subtle rounded-lg text-xs text-theme-muted"
          data-testid="chat-not-running-notice"
        >
          The agent is not currently running. Chat will be available when an agent is actively
          working on this task.
        </div>
      )}

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollContainerRef}
          onScroll={handleChatScroll}
          className="h-full overflow-y-auto p-4 space-y-3"
          data-testid="execute-chat-messages"
        >
          {messages.length === 0 && (
            <div className="text-center py-8 text-theme-muted text-sm">
              <ChatIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>
                {!chatSupported
                  ? "Live chat is not available for this agent backend."
                  : !agentRunning
                    ? "Chat will be available when an agent is actively working on this task."
                    : "Send a message to the agent while it works"}
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <ExecuteChatBubble key={i} msg={msg} />
          ))}
          {sending && (
            <div className="flex justify-start" data-testid="chat-typing-indicator">
              <div className="bg-theme-border-subtle rounded-2xl px-3.5 py-2.5 text-sm text-theme-muted">
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-theme-muted rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-theme-muted rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-theme-muted rounded-full animate-bounce [animation-delay:300ms]" />
                </span>
              </div>
            </div>
          )}
          <div ref={chatMessagesEndRef} />
        </div>
        {showChatJumpToBottom && (
          <button
            type="button"
            onClick={chatJumpToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 text-xs font-medium rounded-full bg-theme-surface border border-theme-border text-theme-text shadow-md hover:bg-theme-border-subtle/50 transition-colors z-10"
            data-testid="chat-jump-to-bottom"
            aria-label="Jump to latest messages"
          >
            Jump to latest
          </button>
        )}
      </div>

      {/* Input */}
      <div className="p-3 shrink-0">
        <ChatInput
          value={chatInput}
          onChange={setChatInput}
          onSend={handleSend}
          sendDisabled={sendDisabled}
          inputDisabled={inputDisabled}
          sendDisabledTooltip={sendTooltip}
          placeholder={
            !chatSupported
              ? "Chat unavailable with CLI backend"
              : !agentRunning
                ? "Agent not running"
                : "Message the agent…"
          }
          inputRef={inputRef}
          aria-label="Execute chat message"
        />
      </div>
    </div>
  );
}
