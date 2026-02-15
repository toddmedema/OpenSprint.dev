import { useState, useEffect } from "react";
import { api } from "../../api/client";
import type { Plan } from "@opensprint/shared";

interface PlanPhaseProps {
  projectId: string;
}

export function PlanPhase({ projectId }: PlanPhaseProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.plans
      .list(projectId)
      .then((data) => setPlans(data as Plan[]))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleShip = async (planId: string) => {
    setError(null);
    try {
      await api.plans.ship(projectId, planId);
      const data = await api.plans.list(projectId);
      setPlans(data as Plan[]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to ship plan";
      setError(msg);
    }
  };

  const statusColors: Record<string, string> = {
    planning: "bg-yellow-50 text-yellow-700",
    shipped: "bg-blue-50 text-blue-700",
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
        {/* Dependency Graph Placeholder */}
        <div className="card p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Dependency Graph</h3>
          <div className="h-40 flex items-center justify-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
            Dependency graph visualization will be rendered here
          </div>
        </div>

        {/* Plan Cards */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Feature Plans</h2>
          <button className="btn-primary text-sm">Add Plan</button>
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading plans...</div>
        ) : plans.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-gray-500 mb-4">
              No plans yet. Start a conversation in the Design phase to generate plans.
            </p>
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
                </div>

                {plan.status === "planning" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShip(plan.metadata.planId);
                    }}
                    className="btn-primary text-xs w-full"
                  >
                    Ship it!
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sidebar: Plan Detail / Chat */}
      {selectedPlan && (
        <div className="w-[400px] border-l border-gray-200 overflow-y-auto p-6 bg-gray-50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Plan Details</h3>
            <button onClick={() => setSelectedPlan(null)} className="text-gray-400 hover:text-gray-600">
              Close
            </button>
          </div>
          <div className="prose prose-sm max-w-none">
            <pre className="whitespace-pre-wrap text-xs bg-white p-4 rounded-lg border">{selectedPlan.content}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
