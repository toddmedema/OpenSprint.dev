import type { RefObject } from "react";
import { CollapsibleSection } from "../../../components/execute/CollapsibleSection";
import { getPlanChatMessageDisplay } from "./planPhaseUtils";

export type PlanRefineChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

export function PlanRefineWithAISection({
  expanded,
  onToggle,
  messages,
  chatSending,
  messagesEndRef,
  questionNotificationId,
}: {
  expanded: boolean;
  onToggle: () => void;
  messages: PlanRefineChatMessage[];
  chatSending: boolean;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  questionNotificationId?: string;
}) {
  return (
    <CollapsibleSection
      title="Refine with AI"
      expanded={expanded}
      onToggle={onToggle}
      expandAriaLabel="Expand Refine with AI"
      collapseAriaLabel="Collapse Refine with AI"
      contentId="plan-refine-content"
      headerId="plan-refine-header"
      contentClassName="p-4 pt-0"
      sectionNavId="plan-refine-section"
      sectionNavTitle="Refine with AI"
    >
      <div
        className="space-y-3"
        data-testid="plan-chat-messages"
        {...(questionNotificationId && { "data-question-id": questionNotificationId })}
      >
        {messages.length === 0 && (
          <p className="text-sm text-theme-muted">
            Chat with the planning agent to refine this plan. Ask questions, suggest changes, or
            request updates.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={`${msg.role}-${i}-${msg.timestamp}`}
            data-testid={`plan-chat-message-${msg.role}`}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "border border-theme-border bg-theme-surface text-theme-text shadow-sm"
                  : "bg-theme-surface border border-theme-border text-theme-text"
              }`}
            >
              <p className="whitespace-pre-wrap">{getPlanChatMessageDisplay(msg.content)}</p>
            </div>
          </div>
        ))}
        {chatSending && (
          <div className="flex justify-start">
            <div className="bg-theme-surface border border-theme-border rounded-2xl px-3 py-2 text-sm text-theme-muted">
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </CollapsibleSection>
  );
}
