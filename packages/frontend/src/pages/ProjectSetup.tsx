import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getProjectPhasePath } from "../lib/phaseRouting";
import { Layout } from "../components/layout/Layout";
import { FolderBrowser } from "../components/FolderBrowser";
import {
  ProjectMetadataStep,
  isValidProjectMetadata,
  RepositoryStep,
  AgentsStep,
  DeploymentStep,
  TestingStep,
  HilStep,
  ConfirmStep,
} from "../components/ProjectSetupWizard";
import type { ProjectMetadataState } from "../components/ProjectSetupWizard";
import type {
  AgentType,
  DeploymentMode,
  HilConfig,
  UnknownScopeStrategy,
} from "@opensprint/shared";
import { DEFAULT_HIL_CONFIG } from "@opensprint/shared";
import { api } from "../api/client";

type Step = "basics" | "agents" | "deployment" | "testing" | "hil" | "confirm";

const STEPS: { key: Step; label: string }[] = [
  { key: "basics", label: "Project Info" },
  { key: "agents", label: "Agent Config" },
  { key: "deployment", label: "Deliver" },
  { key: "testing", label: "Testing" },
  { key: "hil", label: "Autonomy" },
  { key: "confirm", label: "Confirm" },
];

export function ProjectSetup() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("basics");
  const [creating, setCreating] = useState(false);

  const [metadata, setMetadata] = useState<ProjectMetadataState>({ name: "" });
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState("");
  const [planningAgent, setPlanningAgent] = useState({
    type: "cursor" as AgentType,
    model: "",
    cliCommand: "",
  });
  const [codingAgent, setCodingAgent] = useState({
    type: "cursor" as AgentType,
    model: "",
    cliCommand: "",
  });
  const [deploymentMode, setDeploymentMode] = useState<DeploymentMode>("custom");
  const [customDeployCommand, setCustomDeployCommand] = useState("");
  const [customDeployWebhook, setCustomDeployWebhook] = useState("");
  const [testFramework, setTestFramework] = useState<string>("none");
  const [hilConfig, setHilConfig] = useState<HilConfig>(DEFAULT_HIL_CONFIG);
  const [maxConcurrentCoders, setMaxConcurrentCoders] = useState(1);
  const [unknownScopeStrategy, setUnknownScopeStrategy] =
    useState<UnknownScopeStrategy>("optimistic");
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  const [detectedFramework, setDetectedFramework] = useState<string | null>(null);
  const [detectingFramework, setDetectingFramework] = useState(false);

  const [envKeys, setEnvKeys] = useState<{
    anthropic: boolean;
    cursor: boolean;
    claudeCli: boolean;
  } | null>(null);
  const [savingKey, setSavingKey] = useState<"ANTHROPIC_API_KEY" | "CURSOR_API_KEY" | null>(null);
  const [keyInput, setKeyInput] = useState<{ anthropic: string; cursor: string }>({
    anthropic: "",
    cursor: "",
  });
  const [modelRefreshTrigger, setModelRefreshTrigger] = useState(0);
  const [createError, setCreateError] = useState<string | null>(null);

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  useEffect(() => {
    if (step !== "agents") return;
    api.env
      .getKeys()
      .then(setEnvKeys)
      .catch(() => setEnvKeys(null));
  }, [step]);

  useEffect(() => {
    if (step !== "testing" || !repoPath.trim()) return;
    setDetectingFramework(true);
    setDetectedFramework(null);
    api.filesystem
      .detectTestFramework(repoPath.trim())
      .then((result) => {
        if (result) {
          setDetectedFramework(result.framework);
          setTestFramework(result.framework);
        } else {
          setDetectedFramework(null);
        }
      })
      .catch(() => setDetectedFramework(null))
      .finally(() => setDetectingFramework(false));
  }, [step, repoPath]);

  const handleSaveKey = async (envKey: "ANTHROPIC_API_KEY" | "CURSOR_API_KEY") => {
    const value = envKey === "ANTHROPIC_API_KEY" ? keyInput.anthropic : keyInput.cursor;
    if (!value.trim()) return;
    setSavingKey(envKey);
    try {
      await api.env.saveKey(envKey, value.trim());
      setEnvKeys((prev) =>
        prev ? { ...prev, [envKey === "ANTHROPIC_API_KEY" ? "anthropic" : "cursor"]: true } : null
      );
      setKeyInput((prev) => ({
        ...prev,
        [envKey === "ANTHROPIC_API_KEY" ? "anthropic" : "cursor"]: "",
      }));
      setModelRefreshTrigger((n) => n + 1);
    } catch {
      // Error handled by api client
    } finally {
      setSavingKey(null);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const project = await api.projects.create({
        name: metadata.name.trim(),
        repoPath,
        planningAgent: {
          type: planningAgent.type,
          model: planningAgent.type === "custom" ? null : planningAgent.model || null,
          cliCommand:
            planningAgent.type === "custom" && planningAgent.cliCommand.trim()
              ? planningAgent.cliCommand.trim()
              : null,
        },
        codingAgent: {
          type: codingAgent.type,
          model: codingAgent.type === "custom" ? null : codingAgent.model || null,
          cliCommand:
            codingAgent.type === "custom" && codingAgent.cliCommand.trim()
              ? codingAgent.cliCommand.trim()
              : null,
        },
        deployment: {
          mode: deploymentMode,
          expoConfig: deploymentMode === "expo" ? { channel: "preview" } : undefined,
          customCommand:
            deploymentMode === "custom" && customDeployCommand.trim()
              ? customDeployCommand.trim()
              : undefined,
          webhookUrl:
            deploymentMode === "custom" && customDeployWebhook.trim()
              ? customDeployWebhook.trim()
              : undefined,
        },
        hilConfig,
        testFramework: testFramework === "none" ? null : testFramework,
        maxConcurrentCoders,
        unknownScopeStrategy,
      });
      navigate(getProjectPhasePath((project as { id: string }).id, "sketch"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create project";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Layout>
      <div className="h-full overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-10">
          <h1 className="text-2xl font-bold text-theme-text mb-8">Create New Project</h1>

          <nav aria-label="Setup wizard steps" className="overflow-x-auto mb-8">
            <ol className="flex items-center gap-2 min-w-0">
              {STEPS.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2 shrink-0">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
                      i <= currentStepIndex
                        ? "bg-brand-600 text-white"
                        : "bg-theme-surface-muted text-theme-muted"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <span
                    className={`text-sm whitespace-nowrap ${i <= currentStepIndex ? "text-theme-text" : "text-theme-muted"}`}
                  >
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && (
                    <div
                      className={`w-8 h-0.5 shrink-0 ${i < currentStepIndex ? "bg-brand-600" : "bg-theme-border"}`}
                    />
                  )}
                </li>
              ))}
            </ol>
          </nav>

          <div className="card p-6">
            {step === "basics" && (
              <>
                <ProjectMetadataStep
                  value={metadata}
                  onChange={(v) => {
                    setMetadata(v);
                    setMetadataError(null);
                  }}
                  error={metadataError}
                />
                <RepositoryStep
                  value={repoPath}
                  onChange={setRepoPath}
                  onBrowse={() => setShowFolderBrowser(true)}
                />
              </>
            )}

            {step === "agents" && (
              <AgentsStep
                planningAgent={planningAgent}
                codingAgent={codingAgent}
                onPlanningAgentChange={setPlanningAgent}
                onCodingAgentChange={setCodingAgent}
                envKeys={envKeys}
                keyInput={keyInput}
                onKeyInputChange={(key, value) => setKeyInput((p) => ({ ...p, [key]: value }))}
                savingKey={savingKey}
                onSaveKey={handleSaveKey}
                modelRefreshTrigger={modelRefreshTrigger}
                maxConcurrentCoders={maxConcurrentCoders}
                onMaxConcurrentCodersChange={setMaxConcurrentCoders}
                unknownScopeStrategy={unknownScopeStrategy}
                onUnknownScopeStrategyChange={setUnknownScopeStrategy}
              />
            )}

            {step === "deployment" && (
              <DeploymentStep
                mode={deploymentMode}
                customCommand={customDeployCommand}
                customWebhook={customDeployWebhook}
                onModeChange={setDeploymentMode}
                onCustomCommandChange={setCustomDeployCommand}
                onCustomWebhookChange={setCustomDeployWebhook}
              />
            )}

            {step === "testing" && (
              <TestingStep
                value={testFramework}
                onChange={setTestFramework}
                detectingFramework={detectingFramework}
                detectedFramework={detectedFramework}
              />
            )}

            {step === "hil" && <HilStep value={hilConfig} onChange={setHilConfig} />}

            {step === "confirm" && (
              <ConfirmStep
                metadata={metadata}
                repoPath={repoPath}
                planningAgent={planningAgent}
                codingAgent={codingAgent}
                deploymentMode={deploymentMode}
                customDeployCommand={customDeployCommand}
                customDeployWebhook={customDeployWebhook}
                testFramework={testFramework}
                maxConcurrentCoders={maxConcurrentCoders}
                unknownScopeStrategy={unknownScopeStrategy}
              />
            )}
          </div>

          {createError && (
            <div className="mt-4 p-3 bg-theme-error-bg border border-theme-error-border rounded-lg text-sm text-theme-error-text flex justify-between items-center">
              <span>{createError}</span>
              <button
                type="button"
                onClick={() => setCreateError(null)}
                className="text-theme-error-text hover:opacity-80 underline"
              >
                Dismiss
              </button>
            </div>
          )}
          <div className="flex justify-between mt-6">
            <button
              onClick={() => {
                setMetadataError(null);
                setStep(STEPS[currentStepIndex - 1]?.key ?? "basics");
              }}
              disabled={currentStepIndex === 0}
              className="btn-secondary disabled:opacity-50"
            >
              Back
            </button>
            {step === "confirm" ? (
              <button
                onClick={handleCreate}
                disabled={
                  creating ||
                  (planningAgent.type === "custom" && !planningAgent.cliCommand.trim()) ||
                  (codingAgent.type === "custom" && !codingAgent.cliCommand.trim())
                }
                className="btn-primary disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Project"}
              </button>
            ) : step === "basics" ? (
              <button
                onClick={() => {
                  if (isValidProjectMetadata(metadata)) {
                    setMetadataError(null);
                    setStep("agents");
                  } else {
                    setMetadataError("Project name is required");
                  }
                }}
                disabled={!repoPath.trim()}
                className="btn-primary disabled:opacity-50"
              >
                Next
              </button>
            ) : (
              <button
                onClick={() => setStep(STEPS[currentStepIndex + 1]?.key ?? "confirm")}
                disabled={
                  step === "agents" &&
                  ((planningAgent.type === "custom" && !planningAgent.cliCommand.trim()) ||
                    (codingAgent.type === "custom" && !codingAgent.cliCommand.trim()))
                }
                className="btn-primary disabled:opacity-50"
              >
                Next
              </button>
            )}
          </div>
        </div>

        {showFolderBrowser && (
          <FolderBrowser
            initialPath={repoPath || undefined}
            onSelect={(path) => {
              setRepoPath(path);
              setShowFolderBrowser(false);
            }}
            onCancel={() => setShowFolderBrowser(false)}
          />
        )}
      </div>
    </Layout>
  );
}
