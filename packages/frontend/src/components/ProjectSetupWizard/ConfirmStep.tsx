import { TEST_FRAMEWORKS, type AgentConfig, type UnknownScopeStrategy } from "@opensprint/shared";
import type { ProjectMetadataState } from "./ProjectMetadataStep";

export interface ConfirmStepProps {
  metadata: ProjectMetadataState;
  repoPath: string;
  planningAgent: AgentConfig;
  codingAgent: AgentConfig;
  deploymentMode: string;
  customDeployCommand: string;
  customDeployWebhook: string;
  testFramework: string;
  maxConcurrentCoders: number;
  /** Shown in summary when maxConcurrentCoders > 1 */
  unknownScopeStrategy?: UnknownScopeStrategy;
}

export function ConfirmStep({
  metadata,
  repoPath,
  planningAgent,
  codingAgent,
  deploymentMode,
  customDeployCommand,
  customDeployWebhook,
  testFramework,
  maxConcurrentCoders,
  unknownScopeStrategy,
}: ConfirmStepProps) {
  const providerDisplayName = (type: string) => {
    switch (type) {
      case "claude": return "Claude (API)";
      case "claude-cli": return "Claude (CLI)";
      case "cursor": return "Cursor";
      default: return type;
    }
  };

  const planningLabel =
    planningAgent.type === "custom"
      ? (planningAgent.cliCommand ?? "").trim()
        ? `Custom: ${(planningAgent.cliCommand ?? "").trim()}`
        : "Custom (not configured)"
      : `${providerDisplayName(planningAgent.type)}${planningAgent.model ? ` — ${planningAgent.model}` : ""}`;

  const codingLabel =
    codingAgent.type === "custom"
      ? (codingAgent.cliCommand ?? "").trim()
        ? `Custom: ${(codingAgent.cliCommand ?? "").trim()}`
        : "Custom (not configured)"
      : `${providerDisplayName(codingAgent.type)}${codingAgent.model ? ` — ${codingAgent.model}` : ""}`;

  const deploymentLabel =
    deploymentMode === "custom"
      ? customDeployCommand.trim()
        ? `Custom: ${customDeployCommand.trim()}`
        : customDeployWebhook.trim()
          ? `Webhook: ${customDeployWebhook.trim()}`
          : "Custom (not configured)"
      : "Expo";

  const testLabel =
    testFramework === "none"
      ? "None"
      : (TEST_FRAMEWORKS.find((f) => f.id === testFramework)?.label ?? testFramework);

  return (
    <div className="space-y-4" data-testid="confirm-step">
      <h3 className="text-sm font-semibold text-theme-text">Review your project setup</h3>
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-theme-muted">Name</dt>
          <dd className="font-medium">{metadata.name}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-theme-muted">Repository</dt>
          <dd className="font-mono text-xs">{repoPath}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-theme-muted">Planning Agent Slot</dt>
          <dd className="font-medium capitalize">{planningLabel}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-theme-muted">Coding Agent Slot</dt>
          <dd className="font-medium capitalize">{codingLabel}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-theme-muted">Deliver</dt>
          <dd className="font-medium">{deploymentLabel}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-theme-muted">Test Framework</dt>
          <dd className="font-medium">{testLabel}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-theme-muted">Concurrent Coders</dt>
          <dd className="font-medium">
            {maxConcurrentCoders === 1 ? "1 (sequential)" : maxConcurrentCoders}
          </dd>
        </div>
        {maxConcurrentCoders > 1 && unknownScopeStrategy != null && (
          <div className="flex justify-between">
            <dt className="text-theme-muted">Unknown scope strategy</dt>
            <dd className="font-medium capitalize">{unknownScopeStrategy}</dd>
          </div>
        )}
      </dl>
      <p className="text-xs text-theme-muted pt-2 border-t border-theme-border">
        On create: beads will be initialized with auto-flush and auto-commit disabled (orchestrator manages persistence).
        <code className="font-mono">.opensprint/orchestrator-state.json</code> and{" "}
        <code className="font-mono">.opensprint/worktrees/</code> will be added to .gitignore.
      </p>
    </div>
  );
}
