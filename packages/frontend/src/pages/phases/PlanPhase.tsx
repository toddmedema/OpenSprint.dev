import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../api/client";
import { useWebSocket } from "../../hooks/useWebSocket";
import type { Plan, PlanDependencyGraph } from "@opensprint/shared";
import { AddPlanModal } from "../../components/AddPlanModal";
import { DependencyGraph } from "../../components/DependencyGraph";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface PlanPhaseProps {
  projectId: string;
}

export function PlanPhase({ projectId }: PlanPhaseProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [dependencyGraph, setDependencyGraph] = useState<PlanDependencyGraph | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddPlanModal, setShowAddPlanModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const refreshPlans = useCallback(async (): Promise<Plan[]> => {
    const [listData, depsData] = await Promise.all([
      api.plans.list(projectId),
      api.plans.dependencies(projectId).catch(() => null),
    ]);
    const planList = listData as Plan[];
    setPlans(planList);
    setDependencyGraph(depsData as PlanDependencyGraph | null);
    return planList;
  }, [projectId]);

  useEffect(() => {
    refreshPlans()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshPlans]);

  const handleShip = async (planId: string) => {
    setError(null);
    try {
      await api.plans.ship(projectId, planId);
      await refreshPlans();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start build";
      setError(msg);
    }
  };

  const handleReship = async (planId: string) => {
    setError(null);
    try {
      await api.plans.reship(projectId, planId);
      await refreshPlans();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to rebuild plan";
      setError(msg);
    }
  };

  const handlePlanCreated = (plan: Plan) => {
    setPlans((prev) => [...prev, plan]);
  };

  const planContext = selectedPlan ? `plan:${selectedPlan.metadata.planId}` : null;

  const refetchChatHistory = useCallback(async () => {
    if (!planContext) return;
    const conv = (await api.chat.history(projectId, planContext)) as { messages?: Message[] };
    setChatMessages(conv?.messages ?? []);
  }, [projectId, planContext]);

  useEffect(() => {
    if (selectedPlan) {
      refetchChatHistory();
      setChatError(null);
    } else {
      setChatMessages([]);
    }
  }, [selectedPlan, refetchChatHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useWebSocket({
    projectId,
    onEvent: (event) => {
      if (event.type === "plan.updated" && selectedPlan && event.planId === selectedPlan.metadata.planId) {
        refreshPlans().then((planList) => {
          const updated = planList.find((p) => p.metadata.planId === selectedPlan.metadata.planId);
          if (updated) setSelectedPlan(updated);
        });
      }
    },
  });

  const handleSendChat = async () => {
    if (!chatInput.trim() || !planContext || chatSending) return;

    const userMessage: Message = {
      role: "user",
      content: chatInput.trim(),
      timestamp: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatSending(true);
    setChatError(null);

    try {
      const response = (await api.chat.send(projectId, userMessage.content, planContext)) as { message: string };
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: response.message, timestamp: new Date().toISOString() },
      ]);
      await refreshPlans();
      const updated = await api.plans.get(projectId, selectedPlan!.metadata.planId);
      setSelectedPlan(updated as Plan);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to send message. Please try again.");
    } finally {
      setChatSending(false);
    }
  };

  const statusColors: Record<string, string> = {
    planning: "bg-yellow-50 text-yellow-700",
    building: "bg-blue-50 text-blue-700",
    complete: "bg-green-50 text-green-700",
  };

  return (
    <div className="flex h-full">
      {error && (
        <div className="mx-4 mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex justify-between items-center">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-500 hover:text-red-700 underline">
            Dismiss
          </button>
        </div>
      )}
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Dependency Graph */}
        <div className="card p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Dependency Graph</h3>
          <DependencyGraph graph={dependencyGraph} onPlanClick={setSelectedPlan} />
        </div>

        {/* Plan Cards */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Feature Plans</h2>
          <button type="button" onClick={() => setShowAddPlanModal(true)} className="btn-primary text-sm">
            Add Feature
          </button>
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading plans...</div>
        ) : plans.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-gray-500 mb-4">
              No plans yet. Use &ldquo;Plan it&rdquo; from the Dream phase to decompose the PRD into feature plans and
              tasks, or add a plan manually.
            </p>
            <button type="button" onClick={() => setShowAddPlanModal(true)} className="btn-primary">
              Add Feature
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {plans.map((plan) => (
              <div
                key={plan.metadata.planId}
                className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setSelectedPlan(plan)}
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">{plan.metadata.planId.replace(/-/g, " ")}</h3>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                      statusColors[plan.status] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {plan.status}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                  <span>{plan.taskCount} tasks</span>
                  <span>{plan.completedTaskCount} completed</span>
                  <span className="capitalize">{plan.metadata.complexity} complexity</span>
                  {plan.dependencyCount > 0 && <span>{plan.dependencyCount} deps</span>}
                </div>

                {plan.status === "planning" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShip(plan.metadata.planId);
                    }}
                    className="btn-primary text-xs w-full"
                  >
                    Build It!
                  </button>
                )}
                {plan.status === "complete" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReship(plan.metadata.planId);
                    }}
                    className="btn-secondary text-xs w-full"
                  >
                    Rebuild
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddPlanModal && (
        <AddPlanModal projectId={projectId} onClose={() => setShowAddPlanModal(false)} onCreated={handlePlanCreated} />
      )}

      {/* Sidebar: Plan Detail + Chat (PRD §7.2.4) */}
      {selectedPlan && (
        <div className="w-[420px] border-l border-gray-200 flex flex-col bg-gray-50">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 shrink-0">
            <h3 className="font-semibold text-gray-900">{selectedPlan.metadata.planId.replace(/-/g, " ")}</h3>
            <button onClick={() => setSelectedPlan(null)} className="text-gray-400 hover:text-gray-600">
              Close
            </button>
          </div>

          {/* Scrollable content area: plan + mockups + chat messages */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {/* Plan markdown */}
            <div className="p-4 border-b border-gray-200">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Plan</h4>
              <div className="prose prose-sm max-w-none bg-white p-4 rounded-lg border text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedPlan.content || "_No content yet_"}</ReactMarkdown>
              </div>
            </div>

            {/* Mockups */}
            {selectedPlan.metadata.mockups && selectedPlan.metadata.mockups.length > 0 && (
              <div className="p-4 border-b border-gray-200">
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Mockups</h4>
                <div className="space-y-3">
                  {selectedPlan.metadata.mockups.map((mockup, i) => (
                    <div key={i} className="bg-white rounded-lg border overflow-hidden">
                      <div className="px-3 py-1.5 bg-gray-50 border-b">
                        <span className="text-xs font-medium text-gray-700">{mockup.title}</span>
                      </div>
                      <pre className="p-3 text-xs leading-tight text-gray-800 overflow-x-auto font-mono whitespace-pre">
                        {mockup.content}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chat messages */}
            <div className="p-4">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Refine with AI</h4>
              <div className="space-y-3">
                {chatMessages.length === 0 && (
                  <p className="text-sm text-gray-500">
                    Chat with the planning agent to refine this plan. Ask questions, suggest changes, or request
                    updates.
                  </p>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-brand-600 text-white"
                          : "bg-white border border-gray-200 text-gray-900"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}
                {chatSending && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-200 rounded-2xl px-3 py-2 text-sm text-gray-400">
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>

          {/* Pinned chat input at bottom */}
          <div className="shrink-0 border-t border-gray-200 p-4 bg-gray-50">
            {chatError && (
              <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex justify-between items-center">
                <span>{chatError}</span>
                <button
                  type="button"
                  onClick={() => setChatError(null)}
                  className="text-red-500 hover:text-red-700 underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                className="input flex-1 text-sm"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendChat()}
                placeholder="Refine this plan..."
                disabled={chatSending}
              />
              <button
                onClick={handleSendChat}
                disabled={chatSending || !chatInput.trim()}
                className="btn-primary text-sm py-2 px-3 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
