import { ModelSelect } from "../ModelSelect";
import type { AgentType, UnknownScopeStrategy } from "@opensprint/shared";

export interface AgentConfig {
  type: AgentType;
  model: string;
  cliCommand: string;
}

export interface EnvKeys {
  anthropic: boolean;
  cursor: boolean;
  claudeCli: boolean;
}

export interface AgentsStepProps {
  planningAgent: AgentConfig;
  codingAgent: AgentConfig;
  onPlanningAgentChange: (config: AgentConfig) => void;
  onCodingAgentChange: (config: AgentConfig) => void;
  envKeys: EnvKeys | null;
  keyInput: { anthropic: string; cursor: string };
  onKeyInputChange: (key: "anthropic" | "cursor", value: string) => void;
  savingKey: "ANTHROPIC_API_KEY" | "CURSOR_API_KEY" | null;
  onSaveKey: (key: "ANTHROPIC_API_KEY" | "CURSOR_API_KEY") => void;
  modelRefreshTrigger: number;
  maxConcurrentCoders: number;
  onMaxConcurrentCodersChange: (value: number) => void;
  unknownScopeStrategy: UnknownScopeStrategy;
  onUnknownScopeStrategyChange: (value: UnknownScopeStrategy) => void;
}

export function AgentsStep({
  planningAgent,
  codingAgent,
  onPlanningAgentChange,
  onCodingAgentChange,
  envKeys,
  keyInput,
  onKeyInputChange,
  savingKey,
  onSaveKey,
  modelRefreshTrigger,
  maxConcurrentCoders,
  onMaxConcurrentCodersChange,
  unknownScopeStrategy,
  onUnknownScopeStrategyChange,
}: AgentsStepProps) {
  const needsAnthropic =
    envKeys &&
    !envKeys.anthropic &&
    (planningAgent.type === "claude" || codingAgent.type === "claude");
  const needsCursor =
    envKeys &&
    !envKeys.cursor &&
    (planningAgent.type === "cursor" || codingAgent.type === "cursor");
  const usesClaudeCli =
    planningAgent.type === "claude-cli" || codingAgent.type === "claude-cli";
  const claudeCliMissing = envKeys && !envKeys.claudeCli && usesClaudeCli;

  return (
    <div className="space-y-6" data-testid="agents-step">
      {(needsAnthropic || needsCursor) && (
        <>
          <div className="p-3 rounded-lg bg-theme-warning-bg border border-theme-warning-border">
            <p className="text-sm text-theme-warning-text">
              <strong>API key required:</strong>{" "}
              {needsAnthropic && needsCursor
                ? <>Add your <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> and <code className="font-mono text-xs">CURSOR_API_KEY</code> to continue.</>
                : needsAnthropic
                  ? <>Add your <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> to use Claude (API). Get one from{" "}
                    <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">Anthropic Console</a>.</>
                  : <>Add your <code className="font-mono text-xs">CURSOR_API_KEY</code> to use Cursor. Get one from{" "}
                    <a href="https://cursor.com/settings" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">Cursor → Integrations → User API Keys</a>.</>
              }
            </p>
          </div>
          <div className="space-y-3">
            {needsAnthropic && (
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-theme-muted mb-1">
                    ANTHROPIC_API_KEY (Claude API)
                  </label>
                  <input
                    type="password"
                    className="input font-mono text-sm"
                    placeholder="sk-ant-..."
                    value={keyInput.anthropic}
                    onChange={(e) => onKeyInputChange("anthropic", e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onSaveKey("ANTHROPIC_API_KEY")}
                  disabled={!keyInput.anthropic.trim() || savingKey !== null}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {savingKey === "ANTHROPIC_API_KEY" ? "Saving…" : "Save"}
                </button>
              </div>
            )}
            {needsCursor && (
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-theme-muted mb-1">
                    CURSOR_API_KEY
                  </label>
                  <input
                    type="password"
                    className="input font-mono text-sm"
                    placeholder="key_..."
                    value={keyInput.cursor}
                    onChange={(e) => onKeyInputChange("cursor", e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onSaveKey("CURSOR_API_KEY")}
                  disabled={!keyInput.cursor.trim() || savingKey !== null}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {savingKey === "CURSOR_API_KEY" ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {claudeCliMissing && (
        <div className="p-3 rounded-lg bg-theme-warning-bg border border-theme-warning-border">
          <p className="text-sm text-theme-warning-text">
            <strong>Claude CLI not found.</strong>{" "}
            Install it from{" "}
            <a href="https://docs.anthropic.com/en/docs/claude-code/overview" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">docs.anthropic.com</a>{" "}
            and run <code className="font-mono text-xs">claude login</code> to authenticate.
          </p>
        </div>
      )}
      {usesClaudeCli && !claudeCliMissing && (
        <div className="p-3 rounded-lg bg-theme-info-bg border border-theme-info-border">
          <p className="text-sm text-theme-info-text">
            Using locally-installed Claude CLI. Make sure you have authenticated with <code className="font-mono text-xs">claude login</code>.
          </p>
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold text-theme-text mb-3">Planning Agent Slot</h3>
        <p className="text-xs text-theme-muted mb-3">
          Used by Dreamer, Planner, Harmonizer, Analyst, Summarizer, Auditor
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-theme-text mb-1">Provider</label>
              <select
                className="input"
                value={planningAgent.type}
                onChange={(e) =>
                  onPlanningAgentChange({ ...planningAgent, type: e.target.value as AgentType })
                }
              >
                <option value="claude">Claude (API)</option>
                <option value="claude-cli">Claude (CLI)</option>
                <option value="cursor">Cursor</option>
                <option value="custom">Custom CLI</option>
              </select>
            </div>
            {planningAgent.type !== "custom" && (
              <div>
                <label className="block text-sm font-medium text-theme-text mb-1">Model</label>
                <ModelSelect
                  provider={planningAgent.type}
                  value={planningAgent.model || null}
                  onChange={(id) => onPlanningAgentChange({ ...planningAgent, model: id ?? "" })}
                  refreshTrigger={modelRefreshTrigger}
                />
              </div>
            )}
          </div>
          {planningAgent.type === "custom" && (
            <div>
              <label className="block text-sm font-medium text-theme-text mb-1">CLI command</label>
              <input
                type="text"
                className="input w-full font-mono text-sm"
                placeholder="e.g. my-agent or /usr/local/bin/my-agent --model gpt-4"
                value={planningAgent.cliCommand}
                onChange={(e) =>
                  onPlanningAgentChange({ ...planningAgent, cliCommand: e.target.value })
                }
              />
              <p className="mt-1 text-xs text-theme-muted">
                Command invoked with prompt as argument. Must accept input and produce output.
              </p>
            </div>
          )}
        </div>
      </div>
      <hr />
      <div>
        <h3 className="text-sm font-semibold text-theme-text mb-3">Coding Agent Slot</h3>
        <p className="text-xs text-theme-muted mb-3">Used by Coder and Reviewer</p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-theme-text mb-1">Provider</label>
              <select
                className="input"
                value={codingAgent.type}
                onChange={(e) =>
                  onCodingAgentChange({ ...codingAgent, type: e.target.value as AgentType })
                }
              >
                <option value="claude">Claude (API)</option>
                <option value="claude-cli">Claude (CLI)</option>
                <option value="cursor">Cursor</option>
                <option value="custom">Custom CLI</option>
              </select>
            </div>
            {codingAgent.type !== "custom" && (
              <div>
                <label className="block text-sm font-medium text-theme-text mb-1">Model</label>
                <ModelSelect
                  provider={codingAgent.type}
                  value={codingAgent.model || null}
                  onChange={(id) => onCodingAgentChange({ ...codingAgent, model: id ?? "" })}
                  refreshTrigger={modelRefreshTrigger}
                />
              </div>
            )}
          </div>
          {codingAgent.type === "custom" && (
            <div>
              <label className="block text-sm font-medium text-theme-text mb-1">CLI command</label>
              <input
                type="text"
                className="input w-full font-mono text-sm"
                placeholder="e.g. my-agent or /usr/local/bin/my-agent --model gpt-4"
                value={codingAgent.cliCommand}
                onChange={(e) =>
                  onCodingAgentChange({ ...codingAgent, cliCommand: e.target.value })
                }
              />
              <p className="mt-1 text-xs text-theme-muted">
                Command invoked with prompt as argument. Must accept input and produce output.
              </p>
            </div>
          )}
        </div>
      </div>
      <hr />
      <div>
        <h3 className="text-sm font-semibold text-theme-text mb-1">Parallelism</h3>
        <p className="text-xs text-theme-muted mb-3">
          Run multiple coding agents simultaneously on independent tasks. Higher values speed up builds but use more resources.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-theme-text mb-2">
              Max Concurrent Coders: <span className="font-bold">{maxConcurrentCoders}</span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={maxConcurrentCoders}
              onChange={(e) => onMaxConcurrentCodersChange(Number(e.target.value))}
              className="w-full accent-brand-600"
              data-testid="max-concurrent-coders-slider"
            />
            <div className="flex justify-between text-xs text-theme-muted mt-1">
              <span>1 (sequential)</span>
              <span>10</span>
            </div>
          </div>
          {maxConcurrentCoders > 1 && (
            <div>
              <label className="block text-sm font-medium text-theme-text mb-1">
                Unknown Scope Strategy
              </label>
              <p className="text-xs text-theme-muted mb-2">
                When file scope can&apos;t be predicted for a task, should the scheduler serialize it or run it in parallel?
              </p>
              <select
                className="input"
                value={unknownScopeStrategy}
                onChange={(e) => onUnknownScopeStrategyChange(e.target.value as UnknownScopeStrategy)}
                data-testid="unknown-scope-strategy-select"
              >
                <option value="optimistic">Optimistic (parallelize, rely on merger)</option>
                <option value="conservative">Conservative (serialize)</option>
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
