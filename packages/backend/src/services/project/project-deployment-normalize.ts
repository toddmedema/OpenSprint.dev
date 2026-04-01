import type { CreateProjectRequest, DeploymentConfig } from "@opensprint/shared";
import { DEFAULT_DEPLOYMENT_CONFIG } from "@opensprint/shared";

const VALID_DEPLOYMENT_MODES = ["expo", "custom"] as const;

/** Normalize deployment config: ensure valid mode, merge with defaults (PRD §6.4, §7.5.4) */
export function normalizeDeployment(input: CreateProjectRequest["deployment"]): DeploymentConfig {
  const mode =
    input?.mode && VALID_DEPLOYMENT_MODES.includes(input.mode as "expo" | "custom")
      ? (input.mode as "expo" | "custom")
      : "custom";
  const hasTargets = input?.targets && input.targets.length > 0;
  const targets = hasTargets
    ? input!.targets
    : input?.envVars && Object.keys(input.envVars).length > 0
      ? [{ name: "production", isDefault: true, envVars: input.envVars }]
      : input?.targets;
  return {
    ...DEFAULT_DEPLOYMENT_CONFIG,
    ...input,
    mode,
    targets,
    envVars: input?.envVars,
    expoConfig: mode === "expo" ? { channel: input?.expoConfig?.channel ?? "preview" } : undefined,
    customCommand: mode === "custom" ? input?.customCommand : undefined,
    webhookUrl: mode === "custom" ? input?.webhookUrl : undefined,
  };
}
