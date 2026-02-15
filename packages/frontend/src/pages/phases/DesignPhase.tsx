import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../api/client";
import { useWebSocket } from "../../hooks/useWebSocket";

interface DesignPhaseProps {
  projectId: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

const PRD_SECTION_ORDER = [
  "executive_summary",
  "problem_statement",
  "goals_and_metrics",
  "user_personas",
  "technical_architecture",
  "feature_list",
  "non_functional_requirements",
  "data_model",
  "api_contracts",
  "open_questions",
] as const;

function combinePrdSections(prdContent: Record<string, string>): string {
  const ordered = PRD_SECTION_ORDER.filter((k) => prdContent[k]).map(
    (k) => prdContent[k]
  );
  const orderSet = new Set<string>(PRD_SECTION_ORDER);
  const rest = Object.keys(prdContent)
    .filter((k) => !orderSet.has(k))
    .map((k) => prdContent[k]);
  const all = [...ordered, ...rest].join("\n\n");
  return all.replace(/\n[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*\n/g, "\n\n");
}

function parsePrdSections(prd: unknown): Record<string, string> {
  const data = prd as { sections?: Record<string, { content: string }> };
  const content: Record<string, string> = {};
  if (data?.sections) {
    for (const [key, section] of Object.entries(data.sections)) {
      content[key] = section.content;
    }
  }
  return content;
}

export function DesignPhase({ projectId }: DesignPhaseProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prdContent, setPrdContent] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const refetchPrd = useCallback(async () => {
    const data = await api.prd.get(projectId);
    setPrdContent(parsePrdSections(data));
  }, [projectId]);

  // Subscribe to live PRD updates via WebSocket
  useWebSocket({
    projectId,
    onEvent: (event) => {
      if (event.type === "prd.updated") {
        refetchPrd();
      }
    },
  });

  // Load conversation history and PRD
  useEffect(() => {
    api.chat.history(projectId, "design").then((data: unknown) => {
      const conv = data as { messages?: Message[] };
      if (conv?.messages) {
        setMessages(conv.messages);
      }
    });

    refetchPrd();
  }, [projectId, refetchPrd]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const response = (await api.chat.send(projectId, userMessage.content, "design")) as {
        message: string;
        prdChanges?: { section: string; previousVersion: number; newVersion: number }[];
      };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response.message,
          timestamp: new Date().toISOString(),
        },
      ]);
      // Live PRD update: refetch when agent applied PRD changes (WebSocket may also fire, but this ensures updates)
      if (response.prdChanges?.length) {
        refetchPrd();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send message. Please try again.";
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* Left: Chat Pane */}
      <div className="flex-1 flex flex-col border-r border-gray-200">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-20">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Start designing your product</h3>
              <p className="text-gray-500 max-w-md mx-auto">
                Describe your product vision and the AI planning agent will help you build a comprehensive PRD through
                conversation.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === "user" ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-900"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-400">Thinking...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-700 underline"
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex gap-3">
            <input
              type="text"
              className="input flex-1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder="Describe your product vision..."
              disabled={sending}
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="btn-primary disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Right: Live PRD */}
      <div className="w-[480px] overflow-y-auto p-6 bg-gray-50">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Living PRD</h2>

        {Object.keys(prdContent).length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            PRD sections will appear here as you design your product
          </div>
        ) : (
          <div className="prose prose-sm prose-gray max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {combinePrdSections(prdContent)}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
