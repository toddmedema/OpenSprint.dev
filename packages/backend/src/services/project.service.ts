import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "util";
import type {
  Project,
  CreateProjectRequest,
  ProjectSettings,
  ProjectSettingsApiUpdate,
  ScaffoldProjectRequest,
  ScaffoldProjectResponse,
  ScaffoldRecoveryInfo,
} from "@opensprint/shared";
import type { ProjectIndexEntry } from "@opensprint/shared";
import {
  OPENSPRINT_DIR,
  SPEC_MD,
  prdToSpecMarkdown,
  DEFAULT_HIL_CONFIG,
  DEFAULT_AI_AUTONOMY_LEVEL,
  DEFAULT_DEPLOYMENT_CONFIG,
  DEFAULT_REVIEW_MODE,
  MIN_VALIDATION_TIMEOUT_MS,
  MAX_VALIDATION_TIMEOUT_MS,
  getTestCommandForFramework,
  hilConfigFromAiAutonomyLevel,
  MAX_TOTAL_CONCURRENT_AGENTS_CAP,
  parseSettings,
  parseTeamMembers,
  getProvidersRequiringApiKeys,
  DEFAULT_AGENT_CONFIG,
  applyGlobalAgentDefaultsToRawRecord,
  omitInheritedAgentTiersForStore,
  projectStoredDefinesSimpleAgent,
  projectStoredDefinesComplexAgent,
  VALID_MERGE_STRATEGIES,
  VALID_SELF_IMPROVEMENT_FREQUENCIES,
  mergeDeploymentConfigPatch,
  deploymentConfigForApiResponse,
} from "@opensprint/shared";
import type { SelfImprovementFrequency } from "@opensprint/shared";
import type { ApiKeyProvider } from "@opensprint/shared";
import { getGlobalSettings } from "./global-settings.service.js";
import type { AiAutonomyLevel, DeploymentConfig, HilConfig } from "@opensprint/shared";
import { taskStore as taskStoreSingleton } from "./task-store.service.js";
import {
  getSettingsFromStore,
  getRawSettingsRecord,
  setSettingsInStore,
  deleteSettingsFromStore,
  getSettingsWithMetaFromStore,
  updateSettingsInStore,
} from "./settings-store.service.js";
import { deleteFeedbackAssetsForProject } from "./feedback-store.service.js";
import { BranchManager } from "./branch-manager.js";
import { detectTestFramework } from "./test-framework.service.js";
import { ensureEasConfig } from "./eas-config.js";
import { projectGitRuntimeCache } from "./project-git-runtime-cache.js";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import * as projectIndex from "./project-index.js";
import { parseAgentConfig, type AgentConfigInput } from "../schemas/agent-config.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { createLogger } from "../utils/logger.js";
import { assertSupportedRepoPath } from "../utils/repo-path-policy.js";
import { getGitNoHooksPath } from "../utils/git-no-hooks.js";
import { shellExec } from "../utils/shell-exec.js";
import {
  ensureGitIdentityConfigured,
  ensureBaseBranchExists,
  ensureRepoHasInitialCommit,
  inspectGitRepoState,
  hasWorkingTreeChanges,
} from "../utils/git-repo-state.js";
import { classifyInitError, attemptRecovery } from "./scaffold-recovery.service.js";
import {
  ensureExpoReactTypeDevDependencies,
  ensureExpoLintMergeGateTooling,
} from "../utils/scaffold-expo-deps.js";
import { getMergeQualityGateCommands } from "./merge-quality-gates.js";

const execAsync = promisify(exec);
const log = createLogger("project");

const DEFAULT_VALIDATION_TIMEOUT_MS = 300_000;
const VALIDATION_TIMEOUT_BUFFER_MS = 30_000;
const VALIDATION_TIMEOUT_MULTIPLIER = 1.8;
const VALIDATION_TIMING_SAMPLE_LIMIT = 30;

/** Next midnight UTC (daily) or next Sunday 00:00 UTC (weekly). Used for nextRunAt in settings response. */
export function getNextScheduledSelfImprovementRunAt(
  frequency: "daily" | "weekly",
  now: Date = new Date()
): string {
  const n = now;
  const y = n.getUTCFullYear();
  const m = n.getUTCMonth();
  const d = n.getUTCDate();
  if (frequency === "daily") {
    return new Date(Date.UTC(y, m, d + 1)).toISOString();
  }
  const day = n.getUTCDay();
  const addDays = day === 0 ? 7 : 7 - day;
  return new Date(Date.UTC(y, m, d + addDays)).toISOString();
}

const VALID_DEPLOYMENT_MODES = ["expo", "custom"] as const;

/** Normalize deployment config: ensure valid mode, merge with defaults (PRD §6.4, §7.5.4) */
function normalizeDeployment(input: CreateProjectRequest["deployment"]): DeploymentConfig {
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

const VALID_AI_AUTONOMY_LEVELS: AiAutonomyLevel[] = ["confirm_all", "major_only", "full"];
const LEGACY_BD_TASK_TRACKING_INSTRUCTION = "Use 'bd' for task tracking";
const OPENSPRINT_RUNTIME_CONTRACT_HEADING = "## Open Sprint Runtime Contract";
const OPENSPRINT_RUNTIME_CONTRACT_SECTION = [
  OPENSPRINT_RUNTIME_CONTRACT_HEADING,
  "",
  "Open Sprint manages task state internally. Do not use external task CLIs.",
  "",
  "- Execute agents start in a prepared worktree with the task branch already checked out.",
  "- Run the smallest relevant non-watch verification for touched workspaces while iterating. Use scoped tests first, add scoped build/typecheck and lint commands when your changes could affect them, and leave the branch in a state where the merge quality gates (`npm run build`, `npm run lint`, `npm run test`) are expected to pass before reporting success.",
  "- If you add, remove, or upgrade package dependencies: run this repo’s install command from the repository root (root `package.json`), update lockfiles as required, and commit manifest and lockfile changes together with the code that uses those packages.",
  "- If you add or change TypeScript tests that use Jest/Vitest/Mocha globals (`describe`, `it`, `expect`, etc.), ensure `npm run build` still passes: add matching dev typings (e.g. `@types/jest`) or exclude those tests from the build TypeScript project. `TS2582: Cannot find name 'describe'` means the build typechecks tests without test-runner types.",
  "- Report completion or blocking questions by writing the exact `.opensprint/active/<task-id>/result.json` payload requested in the task prompt.",
  "- Commit incremental logical units while working so crash recovery can preserve progress.",
  '- If blocked by ambiguity, return `status: "failed"` with `open_questions` instead of guessing.',
  "- Do not push, merge, or close tasks manually; the orchestrator handles validation, task state, merging, and remote publication.",
].join("\n");

function removeLegacyBdTaskTrackingInstruction(content: string): string {
  return content
    .replace(new RegExp(`(^|\\n)${LEGACY_BD_TASK_TRACKING_INSTRUCTION}(?=\\n|$)`, "g"), "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function ensureOpenSprintRuntimeContract(content: string): string {
  const normalized = removeLegacyBdTaskTrackingInstruction(content);
  if (normalized.includes(OPENSPRINT_RUNTIME_CONTRACT_HEADING)) {
    return normalized
      ? `${normalized}\n`
      : `# Agent Instructions\n\n${OPENSPRINT_RUNTIME_CONTRACT_SECTION}\n`;
  }
  if (!normalized.trim()) {
    return `# Agent Instructions\n\n${OPENSPRINT_RUNTIME_CONTRACT_SECTION}\n`;
  }
  return `${normalized}\n\n${OPENSPRINT_RUNTIME_CONTRACT_SECTION}\n`;
}

/** Resolve aiAutonomyLevel and hilConfig from create/update input. aiAutonomyLevel takes precedence. */
function resolveAiAutonomyAndHil(input: {
  aiAutonomyLevel?: AiAutonomyLevel;
  hilConfig?: CreateProjectRequest["hilConfig"];
}): { aiAutonomyLevel: AiAutonomyLevel; hilConfig: HilConfig } {
  const level = input.aiAutonomyLevel;
  if (typeof level === "string" && VALID_AI_AUTONOMY_LEVELS.includes(level)) {
    return { aiAutonomyLevel: level, hilConfig: hilConfigFromAiAutonomyLevel(level) };
  }
  const legacy = input.hilConfig;
  if (legacy && typeof legacy === "object") {
    const derived = parseSettings({ hilConfig: legacy });
    return {
      aiAutonomyLevel: derived.aiAutonomyLevel ?? DEFAULT_AI_AUTONOMY_LEVEL,
      hilConfig: derived.hilConfig,
    };
  }
  return {
    aiAutonomyLevel: DEFAULT_AI_AUTONOMY_LEVEL,
    hilConfig: DEFAULT_HIL_CONFIG,
  };
}

/** Normalize path for comparison: trim and remove trailing slashes. */
function normalizeRepoPath(p: string): string {
  return p.trim().replace(/\/+$/, "") || "";
}

function extractNpmRunScriptName(command: string): string | null {
  const match = command.trim().match(/^npm\s+run\s+([^\s]+)/i);
  return match?.[1] ?? null;
}

function clampValidationTimeoutMs(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_VALIDATION_TIMEOUT_MS;
  const rounded = Math.round(raw);
  return Math.min(MAX_VALIDATION_TIMEOUT_MS, Math.max(MIN_VALIDATION_TIMEOUT_MS, rounded));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return DEFAULT_VALIDATION_TIMEOUT_MS;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx]!;
}

function normalizeValidationSample(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  if (rounded <= 0) return null;
  return Math.min(rounded, MAX_VALIDATION_TIMEOUT_MS);
}

function isPreferredRepoPathEntry(
  candidate: { updatedAt: string | null; createdAt: string },
  current: { updatedAt: string | null; createdAt: string }
): boolean {
  if (candidate.updatedAt !== null && current.updatedAt === null) {
    return true;
  }
  if (candidate.updatedAt === null && current.updatedAt !== null) {
    return false;
  }

  const candidateSortKey = candidate.updatedAt ?? candidate.createdAt;
  const currentSortKey = current.updatedAt ?? current.createdAt;
  if (candidateSortKey !== currentSortKey) {
    return candidateSortKey > currentSortKey;
  }

  return candidate.createdAt > current.createdAt;
}

/** Build default ProjectSettings for a repo (no user input). Used when adopting or repairing. */
function buildDefaultSettings(): ProjectSettings {
  return {
    simpleComplexityAgent: { ...DEFAULT_AGENT_CONFIG },
    complexComplexityAgent: { ...DEFAULT_AGENT_CONFIG },
    deployment: { ...DEFAULT_DEPLOYMENT_CONFIG },
    aiAutonomyLevel: DEFAULT_AI_AUTONOMY_LEVEL,
    hilConfig: { ...DEFAULT_HIL_CONFIG },
    testFramework: null,
    testCommand: null,
    validationTimeoutMsOverride: null,
    reviewMode: DEFAULT_REVIEW_MODE,
    maxConcurrentCoders: 1,
    unknownScopeStrategy: "optimistic",
    gitWorkingMode: "worktree",
    mergeStrategy: "per_task",
    worktreeBaseBranch: "main",
    enableHumanTeammates: false,
    selfImprovementFrequency: "never",
    autoExecutePlans: false,
    runAgentEnhancementExperiments: false,
    selfImprovementPendingCandidateId: undefined,
    selfImprovementActiveBehaviorVersionId: undefined,
    selfImprovementBehaviorVersions: undefined,
    selfImprovementBehaviorHistory: undefined,
  };
}

/** Build canonical ProjectSettings for persistence. */
function toCanonicalSettings(s: ProjectSettings): ProjectSettings {
  const aiAutonomyLevel = s.aiAutonomyLevel ?? DEFAULT_AI_AUTONOMY_LEVEL;
  return {
    simpleComplexityAgent: s.simpleComplexityAgent,
    complexComplexityAgent: s.complexComplexityAgent,
    deployment: s.deployment,
    aiAutonomyLevel,
    hilConfig: hilConfigFromAiAutonomyLevel(aiAutonomyLevel),
    testFramework: s.testFramework ?? null,
    testCommand: s.testCommand ?? null,
    validationTimeoutMsOverride:
      typeof s.validationTimeoutMsOverride === "number"
        ? clampValidationTimeoutMs(s.validationTimeoutMsOverride)
        : null,
    ...(s.validationTimingProfile && {
      validationTimingProfile: {
        ...(Array.isArray(s.validationTimingProfile.scoped) &&
          s.validationTimingProfile.scoped.length > 0 && {
            scoped: s.validationTimingProfile.scoped
              .map((sample) => normalizeValidationSample(sample))
              .filter((sample): sample is number => sample !== null)
              .slice(-VALIDATION_TIMING_SAMPLE_LIMIT),
          }),
        ...(Array.isArray(s.validationTimingProfile.full) &&
          s.validationTimingProfile.full.length > 0 && {
            full: s.validationTimingProfile.full
              .map((sample) => normalizeValidationSample(sample))
              .filter((sample): sample is number => sample !== null)
              .slice(-VALIDATION_TIMING_SAMPLE_LIMIT),
          }),
        ...(s.validationTimingProfile.updatedAt && {
          updatedAt: s.validationTimingProfile.updatedAt,
        }),
      },
    }),
    reviewMode: s.reviewMode ?? DEFAULT_REVIEW_MODE,
    ...(s.reviewAngles && s.reviewAngles.length > 0 && { reviewAngles: s.reviewAngles }),
    ...(s.includeGeneralReview === true && { includeGeneralReview: true }),
    maxConcurrentCoders: s.maxConcurrentCoders ?? 1,
    ...(typeof s.maxTotalConcurrentAgents === "number" &&
      Number.isFinite(s.maxTotalConcurrentAgents) &&
      s.maxTotalConcurrentAgents >= 1 && {
        maxTotalConcurrentAgents: Math.min(
          MAX_TOTAL_CONCURRENT_AGENTS_CAP,
          Math.max(1, Math.round(s.maxTotalConcurrentAgents))
        ),
      }),
    unknownScopeStrategy: s.unknownScopeStrategy ?? "optimistic",
    gitWorkingMode: s.gitWorkingMode ?? "worktree",
    mergeStrategy: s.mergeStrategy ?? "per_task",
    worktreeBaseBranch: s.worktreeBaseBranch ?? "main",
    enableHumanTeammates: s.enableHumanTeammates === true,
    ...(s.teamMembers && s.teamMembers.length > 0 && { teamMembers: s.teamMembers }),
    selfImprovementFrequency: s.selfImprovementFrequency ?? "never",
    ...(s.selfImprovementLastRunAt !== undefined && {
      selfImprovementLastRunAt: s.selfImprovementLastRunAt,
    }),
    ...(s.selfImprovementLastCommitSha !== undefined && {
      selfImprovementLastCommitSha: s.selfImprovementLastCommitSha,
    }),
    autoExecutePlans: s.autoExecutePlans === true,
    runAgentEnhancementExperiments: s.runAgentEnhancementExperiments === true,
    ...(s.selfImprovementReviewMode && { selfImprovementReviewMode: s.selfImprovementReviewMode }),
    ...(s.selfImprovementReviewAngles && s.selfImprovementReviewAngles.length > 0 && { selfImprovementReviewAngles: s.selfImprovementReviewAngles }),
    ...(s.selfImprovementIncludeGeneralReview === true && { selfImprovementIncludeGeneralReview: true }),
    ...(s.selfImprovementPendingCandidateId && {
      selfImprovementPendingCandidateId: s.selfImprovementPendingCandidateId,
    }),
    ...(s.selfImprovementActiveBehaviorVersionId && {
      selfImprovementActiveBehaviorVersionId: s.selfImprovementActiveBehaviorVersionId,
    }),
    ...(Array.isArray(s.selfImprovementBehaviorVersions) &&
      s.selfImprovementBehaviorVersions.length > 0 && {
        selfImprovementBehaviorVersions: s.selfImprovementBehaviorVersions
          .filter((v) => v?.id && v?.promotedAt)
          .map((v) => ({ id: v.id, promotedAt: v.promotedAt })),
      }),
    ...(Array.isArray(s.selfImprovementBehaviorHistory) &&
      s.selfImprovementBehaviorHistory.length > 0 && {
        selfImprovementBehaviorHistory: s.selfImprovementBehaviorHistory
          .filter((h) => h?.timestamp && h?.action)
          .map((h) => ({
            timestamp: h.timestamp,
            action: h.action,
            ...(h.behaviorVersionId && { behaviorVersionId: h.behaviorVersionId }),
            ...(h.candidateId && { candidateId: h.candidateId }),
          })),
      }),
  };
}

export class ProjectService {
  private taskStore = taskStoreSingleton;
  private static readonly BOOTSTRAP_COMMIT_MESSAGE = "chore: initialize Open Sprint project";
  /** In-memory cache for listProjects() so GET /projects returns instantly when the event loop is busy (e.g. orchestrator). Invalidated on create/update/delete. */
  private listCache: Project[] | null = null;

  private async stopOrchestratorForProject(projectId: string): Promise<void> {
    try {
      const { orchestratorService } = await import("./orchestrator.service.js");
      orchestratorService.stopProject(projectId);
    } catch (error) {
      log.warn("Failed to stop orchestrator during project cleanup", {
        projectId,
        error,
      });
    }
  }

  private invalidateListCache(): void {
    this.listCache = null;
  }

  /** Clear list cache (for tests that overwrite projects.json directly). */
  clearListCacheForTesting(): void {
    this.listCache = null;
  }

  /** Merge global agent defaults into raw JSON, parse, and annotate inheritance for API responses. */
  private projectSettingsFromRaw(
    raw: Record<string, unknown>,
    gs: Awaited<ReturnType<typeof getGlobalSettings>>
  ): ProjectSettings {
    const normalized = applyGlobalAgentDefaultsToRawRecord(raw, gs);
    const parsed = toCanonicalSettings(parseSettings(normalized));
    return {
      ...parsed,
      simpleComplexityAgentInherited: !projectStoredDefinesSimpleAgent(raw),
      complexComplexityAgentInherited: !projectStoredDefinesComplexAgent(raw),
    };
  }

  private async stageAndCommitPaths(repoPath: string, pathsToStage: string[]): Promise<boolean> {
    const existingPaths: string[] = [];
    for (const relPath of pathsToStage) {
      try {
        await fs.access(path.join(repoPath, relPath));
        existingPaths.push(relPath);
      } catch {
        // File may legitimately not exist in this project shape
      }
    }
    if (existingPaths.length === 0) return false;

    const quoted = existingPaths.map((entry) => `"${entry.replace(/"/g, '\\"')}"`).join(" ");
    await shellExec(`git add -A -- ${quoted}`, { cwd: repoPath });
    const staged = await shellExec("git diff --cached --name-only", { cwd: repoPath });
    if (!staged.stdout.trim()) return false;
    const noHooks = getGitNoHooksPath();
    await shellExec(
      `git -c core.hooksPath="${noHooks}" commit -m "${ProjectService.BOOTSTRAP_COMMIT_MESSAGE}"`,
      { cwd: repoPath, timeout: 30_000 }
    );
    return true;
  }

  private async commitBootstrapChanges(
    repoPath: string,
    options: { includeWholeRepo: boolean; extraPaths?: string[] }
  ): Promise<boolean> {
    if (options.includeWholeRepo) {
      const hasChanges = await hasWorkingTreeChanges(repoPath);
      if (!hasChanges) return false;
      await shellExec("git add -A", { cwd: repoPath });
      const noHooksBootstrap = getGitNoHooksPath();
      await shellExec(
        `git -c core.hooksPath="${noHooksBootstrap}" commit -m "${ProjectService.BOOTSTRAP_COMMIT_MESSAGE}"`,
        { cwd: repoPath, timeout: 30_000 }
      );
      return true;
    }

    return this.stageAndCommitPaths(repoPath, [
      "AGENTS.md",
      ".gitignore",
      "SPEC.md",
      ".opensprint",
      ...(options.extraPaths ?? []),
    ]);
  }

  private async prepareRepoForProject(
    repoPath: string,
    preferredBaseBranch?: string
  ): Promise<{ hadHead: boolean; baseBranch: string }> {
    const repoState = await inspectGitRepoState(repoPath, preferredBaseBranch);
    await ensureGitIdentityConfigured(repoPath);
    const baseBranch = repoState.baseBranch;
    await ensureBaseBranchExists(repoPath, baseBranch);
    return { hadHead: repoState.hasHead, baseBranch };
  }

  private async getPreferredProjectEntry(entries: ProjectIndexEntry[]): Promise<ProjectIndexEntry> {
    let preferred = entries[0];
    let preferredMeta = await getSettingsWithMetaFromStore(preferred.id, buildDefaultSettings());

    for (const entry of entries.slice(1)) {
      const entryMeta = await getSettingsWithMetaFromStore(entry.id, buildDefaultSettings());
      if (
        isPreferredRepoPathEntry(
          { updatedAt: entryMeta.updatedAt, createdAt: entry.createdAt },
          { updatedAt: preferredMeta.updatedAt, createdAt: preferred.createdAt }
        )
      ) {
        preferred = entry;
        preferredMeta = entryMeta;
      }
    }

    return preferred;
  }

  /** List all projects (cached; invalidated on create/update/delete). Settings are in global DB. */
  async listProjects(): Promise<Project[]> {
    if (this.listCache !== null) {
      return this.listCache;
    }
    const entries = await projectIndex.getProjects();
    const projectsByRepoPath = new Map<
      string,
      { project: Project; settingsUpdatedAt: string | null; createdAt: string }
    >();

    for (const entry of entries) {
      try {
        await fs.access(path.join(entry.repoPath, OPENSPRINT_DIR));
        const { updatedAt } = await getSettingsWithMetaFromStore(entry.id, buildDefaultSettings());
        const project: Project = {
          id: entry.id,
          name: entry.name,
          repoPath: entry.repoPath,
          currentPhase: "sketch",
          createdAt: entry.createdAt,
          updatedAt: updatedAt ?? entry.createdAt,
        };
        const normalizedRepoPath = normalizeRepoPath(entry.repoPath);
        const existing = projectsByRepoPath.get(normalizedRepoPath);

        if (
          !existing ||
          isPreferredRepoPathEntry(
            { updatedAt, createdAt: entry.createdAt },
            { updatedAt: existing.settingsUpdatedAt, createdAt: existing.createdAt }
          )
        ) {
          projectsByRepoPath.set(normalizedRepoPath, {
            project,
            settingsUpdatedAt: updatedAt,
            createdAt: entry.createdAt,
          });
        }
      } catch {
        // Project directory may no longer exist — skip it
      }
    }

    const projects = Array.from(projectsByRepoPath.values(), (value) => value.project);
    this.listCache = projects;
    return projects;
  }

  /** Create a new project */
  async createProject(input: CreateProjectRequest): Promise<Project> {
    // Validate required fields
    const name = (input.name ?? "").trim();
    const repoPath = (input.repoPath ?? "").trim();
    if (!name) {
      throw new AppError(400, ErrorCodes.INVALID_INPUT, "Project name is required");
    }
    if (!repoPath) {
      throw new AppError(400, ErrorCodes.INVALID_INPUT, "Project folder is required");
    }
    assertSupportedRepoPath(repoPath);
    const normalizedRepoPath = normalizeRepoPath(repoPath);

    // Agent config: omit both tiers to inherit global defaults; otherwise validate provided tiers only.
    const simpleInput = input.simpleComplexityAgent ?? input.lowComplexityAgent;
    const complexInput = input.complexComplexityAgent ?? input.highComplexityAgent;
    let simpleComplexityAgent: AgentConfigInput | undefined;
    let complexComplexityAgent: AgentConfigInput | undefined;
    try {
      if (simpleInput !== undefined && simpleInput !== null) {
        simpleComplexityAgent = parseAgentConfig(simpleInput, "simpleComplexityAgent");
      }
      if (complexInput !== undefined && complexInput !== null) {
        complexComplexityAgent = parseAgentConfig(complexInput, "complexComplexityAgent");
      }
    } catch (err) {
      const msg = getErrorMessage(err, "Invalid agent configuration");
      throw new AppError(400, ErrorCodes.INVALID_AGENT_CONFIG, msg);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const existingEntries = (await projectIndex.getProjects()).filter(
      (entry) => normalizeRepoPath(entry.repoPath) === normalizedRepoPath
    );

    // If path already has Open Sprint, return the existing project instead of creating
    const opensprintDir = path.join(repoPath, OPENSPRINT_DIR);
    try {
      await fs.access(opensprintDir);
      if (existingEntries.length > 0) {
        const existing = await this.getPreferredProjectEntry(existingEntries);
        return this.getProject(existing.id);
      }
      // Repo has .opensprint but no index entry (e.g. index from another machine or cleared). Adopt it.
      const adoptId = randomUUID();
      const adoptName = name || "Existing project";
      await projectIndex.addProject({
        id: adoptId,
        name: adoptName,
        repoPath: normalizedRepoPath,
        createdAt: now,
      });
      // Ensure settings exist in global store so getSettings() and Sketch/Plan flows work (PRD §6.3).
      const defaults = buildDefaultSettings();
      const adoptInitial = toCanonicalSettings(defaults) as unknown as Record<string, unknown>;
      delete adoptInitial.simpleComplexityAgent;
      delete adoptInitial.complexComplexityAgent;
      delete adoptInitial.lowComplexityAgent;
      delete adoptInitial.highComplexityAgent;
      await setSettingsInStore(adoptId, adoptInitial as unknown as ProjectSettings);
      this.invalidateListCache();
      return this.getProject(adoptId);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Directory doesn't exist — proceed
    }

    for (const entry of existingEntries) {
      await projectIndex.removeProject(entry.id);
    }

    // Ensure repo directory exists
    await fs.mkdir(repoPath, { recursive: true });

    // Initialize git if not already a repo
    try {
      await execAsync("git rev-parse --is-inside-work-tree", { cwd: repoPath });
    } catch {
      await execAsync("git init", { cwd: repoPath });
      await ensureRepoHasInitialCommit(repoPath, input.worktreeBaseBranch);
    }

    const { hadHead, baseBranch } = await this.prepareRepoForProject(
      repoPath,
      input.worktreeBaseBranch
    );

    // Ensure an initial commit exists (e.g. repo was inited elsewhere with no commits)
    if (!hadHead) {
      await ensureRepoHasInitialCommit(repoPath, baseBranch);
    }

    // Task store uses global server only. No per-repo data.

    // Ensure AGENTS.md exists and includes the Open Sprint runtime contract
    const agentsMdPath = path.join(repoPath, "AGENTS.md");
    try {
      const agentsContent = await fs.readFile(agentsMdPath, "utf-8");
      const nextAgentsContent = ensureOpenSprintRuntimeContract(agentsContent);
      if (nextAgentsContent !== agentsContent) {
        await fs.writeFile(agentsMdPath, nextAgentsContent);
      }
    } catch {
      await fs.writeFile(agentsMdPath, ensureOpenSprintRuntimeContract(""));
    }

    // PRD §5.9: Add orchestrator state and worktrees to .gitignore during setup
    const gitignorePath = path.join(repoPath, ".gitignore");
    // Runtime and WIP paths only; feedback, counters, events, agent-stats, deployments are DB-only
    const gitignoreEntries = [
      ".opensprint/orchestrator-state.json",
      ".opensprint/worktrees/",
      ".opensprint/pending-commits.json",
      ".opensprint/sessions/",
      ".opensprint/active/",
    ];
    try {
      let content = await fs.readFile(gitignorePath, "utf-8");
      for (const entry of gitignoreEntries) {
        if (!content.includes(entry)) {
          content += `\n${entry}`;
        }
      }
      await fs.writeFile(gitignorePath, content.trimEnd() + "\n");
    } catch {
      // No .gitignore yet — create one
      await fs.writeFile(gitignorePath, gitignoreEntries.join("\n") + "\n");
    }

    // Keep .opensprint root marker, but canonical project state now lives in the DB.
    await fs.mkdir(opensprintDir, { recursive: true });

    // Write initial SPEC.md (Sketch phase output) with all sections
    const emptySection = () => ({ content: "", version: 0, updatedAt: now });
    const initialPrd = {
      version: 0,
      sections: {
        executive_summary: emptySection(),
        problem_statement: emptySection(),
        user_personas: emptySection(),
        goals_and_metrics: emptySection(),
        assumptions_and_constraints: emptySection(),
        feature_list: emptySection(),
        technical_architecture: emptySection(),
        data_model: emptySection(),
        api_contracts: emptySection(),
        non_functional_requirements: emptySection(),
        open_questions: emptySection(),
      },
      changeLog: [],
    };
    const specPath = path.join(repoPath, SPEC_MD);
    await fs.writeFile(specPath, prdToSpecMarkdown(initialPrd), "utf-8");

    // Write settings (deployment and HIL normalized per PRD §6.4, §6.5)
    const deployment = normalizeDeployment(input.deployment);
    const { aiAutonomyLevel, hilConfig } = resolveAiAutonomyAndHil(input);
    const detected = await detectTestFramework(repoPath);
    const testFramework = input.testFramework ?? detected?.framework ?? null;
    const testCommand =
      (detected?.testCommand ?? getTestCommandForFramework(testFramework)) || null;
    const gitWorkingMode = input.gitWorkingMode === "branches" ? "branches" : "worktree";
    const effectiveMaxConcurrentCoders =
      gitWorkingMode === "branches" ? 1 : (input.maxConcurrentCoders ?? 1);
    const rawMaxTotal = input.maxTotalConcurrentAgents;
    const initialMaxTotal =
      typeof rawMaxTotal === "number" && Number.isFinite(rawMaxTotal) && rawMaxTotal >= 1
        ? Math.min(MAX_TOTAL_CONCURRENT_AGENTS_CAP, Math.max(1, Math.round(rawMaxTotal)))
        : undefined;
    const settingsPayload: Record<string, unknown> = {
      deployment,
      aiAutonomyLevel,
      hilConfig,
      testFramework,
      testCommand,
      reviewMode: DEFAULT_REVIEW_MODE,
      gitWorkingMode,
      worktreeBaseBranch: baseBranch,
      maxConcurrentCoders: effectiveMaxConcurrentCoders,
      ...(initialMaxTotal != null && { maxTotalConcurrentAgents: initialMaxTotal }),
      ...(effectiveMaxConcurrentCoders > 1 &&
        input.unknownScopeStrategy && {
          unknownScopeStrategy: input.unknownScopeStrategy,
        }),
    };
    if (simpleComplexityAgent !== undefined) {
      settingsPayload.simpleComplexityAgent = simpleComplexityAgent;
    }
    if (complexComplexityAgent !== undefined) {
      settingsPayload.complexComplexityAgent = complexComplexityAgent;
    }
    await setSettingsInStore(id, settingsPayload as unknown as ProjectSettings);

    // Create eas.json for Expo projects (PRD §6.4)
    if (deployment.mode === "expo") {
      await ensureEasConfig(repoPath);
    }

    await this.commitBootstrapChanges(repoPath, {
      includeWholeRepo: !hadHead,
      extraPaths: deployment.mode === "expo" ? ["eas.json"] : [],
    });

    // Add to global index
    await projectIndex.addProject({
      id,
      name,
      repoPath,
      createdAt: now,
    });

    this.invalidateListCache();

    // Prime global task store schema so first list-tasks works (ensure-dolt.sh fixes schema at dev start; this touches it at create time).
    try {
      await this.taskStore.listAll(id);
    } catch (e) {
      log.warn("Task store schema not ready after create project", { err: getErrorMessage(e) });
    }

    return {
      id,
      name,
      repoPath,
      currentPhase: "sketch",
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Check that git and node are available before scaffolding. */
  private async checkScaffoldPrerequisites(): Promise<{ missing: string[] }> {
    const missing: string[] = [];
    const timeout = 5000;

    const isCommandNotFound = (err: unknown): boolean => {
      const msg = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code?: string }).code
          : undefined;
      return (
        code === "ENOENT" ||
        /command not found/i.test(msg) ||
        /not recognized/i.test(msg) ||
        /not found/i.test(msg)
      );
    };

    try {
      await execAsync("git --version", { timeout });
    } catch (err) {
      if (isCommandNotFound(err)) {
        missing.push("Git");
      } else {
        throw err;
      }
    }

    try {
      await execAsync("node --version", { timeout });
    } catch (err) {
      if (isCommandNotFound(err)) {
        missing.push("Node.js");
      } else {
        throw err;
      }
    }

    return { missing };
  }

  /** Scaffold a new project from template (Create New wizard). */
  async scaffoldProject(input: ScaffoldProjectRequest): Promise<ScaffoldProjectResponse> {
    const name = (input.name ?? "").trim();
    const parentPath = (input.parentPath ?? "").trim();
    const template = input.template;

    if (!name) {
      throw new AppError(400, ErrorCodes.INVALID_INPUT, "Project name is required");
    }
    if (!parentPath) {
      throw new AppError(400, ErrorCodes.INVALID_INPUT, "Project folder (parentPath) is required");
    }
    if (template !== "web-app-expo-react" && template !== "empty") {
      throw new AppError(
        400,
        ErrorCodes.INVALID_INPUT,
        `Unsupported template: ${template}. Supported templates: "web-app-expo-react", "empty".`
      );
    }

    const repoPath = path.resolve(parentPath);
    assertSupportedRepoPath(repoPath);

    if (template === "empty") {
      await fs.mkdir(repoPath, { recursive: true });

      const createRequest: CreateProjectRequest = {
        name,
        repoPath,
        ...(input.simpleComplexityAgent !== undefined && {
          simpleComplexityAgent: input.simpleComplexityAgent as AgentConfigInput,
        }),
        ...(input.complexComplexityAgent !== undefined && {
          complexComplexityAgent: input.complexComplexityAgent as AgentConfigInput,
        }),
        deployment: DEFAULT_DEPLOYMENT_CONFIG,
        aiAutonomyLevel: DEFAULT_AI_AUTONOMY_LEVEL,
        gitWorkingMode: "worktree",
        maxConcurrentCoders: 1,
        testFramework: null,
      };

      const project = await this.createProject(createRequest);
      return { project };
    }

    const prereq = await this.checkScaffoldPrerequisites();
    if (prereq.missing.length > 0) {
      const list = prereq.missing.join(", ");
      const msg =
        prereq.missing.length === 1
          ? `${list} is not installed or not available in PATH. ` +
            (prereq.missing[0] === "Git"
              ? "Install Git from https://git-scm.com/ and ensure it is in your PATH, then try again."
              : "Install Node.js from https://nodejs.org/ and ensure it is in your PATH, then try again.")
          : `${list} are not installed or not available in PATH. ` +
            "Install Git from https://git-scm.com/ and Node.js from https://nodejs.org/, ensure both are in your PATH, then try again.";
      throw new AppError(400, ErrorCodes.SCAFFOLD_PREREQUISITES_MISSING, msg, {
        missing: prereq.missing,
      });
    }

    const agentConfig = (input.simpleComplexityAgent ??
      DEFAULT_AGENT_CONFIG) as AgentConfigInput & {
      type:
        | "cursor"
        | "claude"
        | "claude-cli"
        | "custom"
        | "openai"
        | "google"
        | "lmstudio"
        | "ollama";
    };
    let recovery: ScaffoldRecoveryInfo | undefined;

    if (template === "web-app-expo-react") {
      await fs.mkdir(repoPath, { recursive: true });

      // Step 1: scaffold Expo app
      const scaffoldResult = await this.runWithRecovery(
        "npx create-expo-app@latest . --template blank --yes",
        repoPath,
        agentConfig,
        "Failed to scaffold Expo app"
      );
      if (scaffoldResult.recovery) {
        recovery = scaffoldResult.recovery;
      }
      if (!scaffoldResult.success) {
        throw new AppError(500, ErrorCodes.SCAFFOLD_INIT_FAILED, scaffoldResult.errorMessage!, {
          repoPath,
          recovery,
        });
      }

      // Step 2: npm install (explicitly include dev deps so test runners like Jest are available)
      const installResult = await this.runWithRecovery(
        "npm install --include=dev",
        repoPath,
        agentConfig,
        "Failed to run npm install"
      );
      if (!recovery && installResult.recovery) {
        recovery = installResult.recovery;
      }
      if (!installResult.success) {
        throw new AppError(500, ErrorCodes.SCAFFOLD_INIT_FAILED, installResult.errorMessage!, {
          repoPath,
          recovery: installResult.recovery ?? recovery,
        });
      }

      // Step 3: install web dependencies for Expo Web template
      try {
        await execAsync("npx expo install react-dom react-native-web", { cwd: repoPath });
      } catch (expoInstallErr) {
        const msg = getErrorMessage(
          expoInstallErr,
          "Failed to install Expo web dependencies (react-dom, react-native-web)"
        );
        throw new AppError(
          500,
          ErrorCodes.SCAFFOLD_INIT_FAILED,
          `Expo web dependencies could not be installed: ${msg}. Ensure Expo CLI is available and try again.`,
          { repoPath, recovery }
        );
      }

      // Step 4: TypeScript + React typings (Expo pins compatible versions; blank template often omits these)
      const tsResult = await this.runWithRecovery(
        "npx expo install typescript @types/react @types/react-dom",
        repoPath,
        agentConfig,
        "Failed to install TypeScript and React type definitions"
      );
      if (!recovery && tsResult.recovery) {
        recovery = tsResult.recovery;
      }
      if (!tsResult.success) {
        throw new AppError(500, ErrorCodes.SCAFFOLD_INIT_FAILED, tsResult.errorMessage!, {
          repoPath,
          recovery: tsResult.recovery ?? recovery,
        });
      }

      try {
        await ensureExpoReactTypeDevDependencies(repoPath);
      } catch (ensureErr) {
        const msg = getErrorMessage(
          ensureErr,
          "Could not ensure @types/react and @types/react-dom are installed"
        );
        throw new AppError(500, ErrorCodes.SCAFFOLD_INIT_FAILED, msg, {
          repoPath,
          recovery,
        });
      }

      try {
        await ensureExpoLintMergeGateTooling(repoPath);
      } catch (lintSetupErr) {
        const msg = getErrorMessage(
          lintSetupErr,
          "Could not install ESLint tooling for merge quality gates (eslint / eslint-config-expo)"
        );
        throw new AppError(500, ErrorCodes.SCAFFOLD_INIT_FAILED, msg, {
          repoPath,
          recovery,
        });
      }

      const lintAfterScaffold = await this.runWithRecovery(
        "npm run lint",
        repoPath,
        agentConfig,
        "npm run lint failed after scaffold (check ESLint config and dependencies)"
      );
      if (!recovery && lintAfterScaffold.recovery) {
        recovery = lintAfterScaffold.recovery;
      }
      if (!lintAfterScaffold.success) {
        throw new AppError(500, ErrorCodes.SCAFFOLD_INIT_FAILED, lintAfterScaffold.errorMessage!, {
          repoPath,
          recovery: lintAfterScaffold.recovery ?? recovery,
        });
      }

      const tsconfigPath = path.join(repoPath, "tsconfig.json");
      try {
        await fs.access(tsconfigPath);
        const typecheckResult = await this.runWithRecovery(
          "npx tsc --noEmit",
          repoPath,
          agentConfig,
          "TypeScript check failed after scaffold (fix missing typings or tsconfig)"
        );
        if (!recovery && typecheckResult.recovery) {
          recovery = typecheckResult.recovery;
        }
        if (!typecheckResult.success) {
          throw new AppError(500, ErrorCodes.SCAFFOLD_INIT_FAILED, typecheckResult.errorMessage!, {
            repoPath,
            recovery: typecheckResult.recovery ?? recovery,
          });
        }
      } catch (accessErr) {
        if (accessErr instanceof AppError) {
          throw accessErr;
        }
        // No tsconfig yet — skip tsc; typings are still in package.json for when TS is enabled.
      }

      // Step 6: validate scaffold with the same canonical merge-gate commands used later.
      let packageScripts = new Set<string>();
      try {
        const packageJsonRaw = await fs.readFile(path.join(repoPath, "package.json"), "utf-8");
        const packageJson = JSON.parse(packageJsonRaw) as { scripts?: Record<string, unknown> } | null;
        if (packageJson?.scripts && typeof packageJson.scripts === "object") {
          packageScripts = new Set(Object.keys(packageJson.scripts));
        }
      } catch {
        // If package.json cannot be read here, gate command execution below will fail with context.
      }
      for (const gateCommand of getMergeQualityGateCommands()) {
        const scriptName = extractNpmRunScriptName(gateCommand);
        if (scriptName && !packageScripts.has(scriptName)) {
          log.info("Skipping scaffold merge-gate command; npm script is not defined", {
            repoPath,
            command: gateCommand,
          });
          continue;
        }
        const gateResult = await this.runWithRecovery(
          gateCommand,
          repoPath,
          agentConfig,
          `Scaffold merge quality gate failed (${gateCommand})`
        );
        if (!recovery && gateResult.recovery) {
          recovery = gateResult.recovery;
        }
        if (!gateResult.success) {
          throw new AppError(500, ErrorCodes.SCAFFOLD_INIT_FAILED, gateResult.errorMessage!, {
            repoPath,
            recovery: gateResult.recovery ?? recovery,
          });
        }
      }
    }

    const simpleInput = input.simpleComplexityAgent ?? DEFAULT_AGENT_CONFIG;
    const complexInput = input.complexComplexityAgent ?? DEFAULT_AGENT_CONFIG;
    const createRequest: CreateProjectRequest = {
      name,
      repoPath,
      simpleComplexityAgent: simpleInput as AgentConfigInput,
      complexComplexityAgent: complexInput as AgentConfigInput,
      deployment: DEFAULT_DEPLOYMENT_CONFIG,
      aiAutonomyLevel: DEFAULT_AI_AUTONOMY_LEVEL,
      gitWorkingMode: "worktree",
      maxConcurrentCoders: 1,
      testFramework: null,
    };

    const project = await this.createProject(createRequest);

    return { project, ...(recovery && { recovery }) };
  }

  /**
   * Run a shell command with agent-driven error recovery.
   * On failure: classifies the error, invokes an agent to fix it, retries once.
   */
  private async runWithRecovery(
    command: string,
    cwd: string,
    agentConfig: AgentConfigInput & { type: string },
    fallbackMessage: string
  ): Promise<{ success: boolean; errorMessage?: string; recovery?: ScaffoldRecoveryInfo }> {
    try {
      await execAsync(command, { cwd });
      return { success: true };
    } catch (firstErr) {
      const rawError = getErrorMessage(firstErr, fallbackMessage);
      const classification = classifyInitError(rawError);

      log.info("Scaffold command failed, attempting recovery", {
        command,
        category: classification.category,
        recoverable: classification.recoverable,
      });

      if (!classification.recoverable) {
        return {
          success: false,
          errorMessage: `${classification.summary}: ${rawError}`,
          recovery: {
            attempted: false,
            success: false,
            errorCategory: classification.category,
            errorSummary: classification.summary,
          },
        };
      }

      const recoveryResult = await attemptRecovery(
        classification,
        cwd,
        agentConfig as AgentConfigInput
      );

      if (!recoveryResult.success) {
        return {
          success: false,
          errorMessage: recoveryResult.errorMessage ?? `${classification.summary}: ${rawError}`,
          recovery: {
            attempted: true,
            success: false,
            errorCategory: classification.category,
            errorSummary: classification.summary,
            agentOutput: recoveryResult.agentOutput,
          },
        };
      }

      // Agent claims success — retry the original command
      log.info("Recovery agent succeeded, retrying command", { command });
      try {
        await execAsync(command, { cwd });
        return {
          success: true,
          recovery: {
            attempted: true,
            success: true,
            errorCategory: classification.category,
            errorSummary: classification.summary,
            agentOutput: recoveryResult.agentOutput,
          },
        };
      } catch (retryErr) {
        const retryMsg = getErrorMessage(retryErr, fallbackMessage);
        return {
          success: false,
          errorMessage: `Recovery agent ran but the command still failed: ${retryMsg}`,
          recovery: {
            attempted: true,
            success: false,
            errorCategory: classification.category,
            errorSummary: classification.summary,
            agentOutput: recoveryResult.agentOutput,
          },
        };
      }
    }
  }

  /** Get a single project by ID */
  async getProject(id: string): Promise<Project> {
    const entries = await projectIndex.getProjects();
    const entry = entries.find((p) => p.id === id);
    if (!entry) {
      throw new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, `Project ${id} not found`, {
        projectId: id,
      });
    }

    // Guard against corrupt index entries missing repoPath
    if (!entry.repoPath || typeof entry.repoPath !== "string") {
      throw new AppError(
        500,
        ErrorCodes.INTERNAL_ERROR,
        `Project ${id} has invalid repoPath in index`,
        {
          projectId: id,
          repoPath: entry.repoPath,
        }
      );
    }

    const { updatedAt } = await getSettingsWithMetaFromStore(id, buildDefaultSettings());

    return {
      id: entry.id,
      name: entry.name,
      repoPath: entry.repoPath,
      currentPhase: "sketch",
      createdAt: entry.createdAt,
      updatedAt: updatedAt ?? entry.createdAt,
    };
  }

  /** Get the repo path for a project */
  async getRepoPath(id: string): Promise<string> {
    const project = await this.getProject(id);
    return project.repoPath;
  }

  /** Get project by repo path (for callers that only have repoPath). */
  async getProjectByRepoPath(repoPath: string): Promise<Project | null> {
    const entries = await projectIndex.getProjects();
    const normalized = normalizeRepoPath(repoPath);
    const entry = entries.find((e) => normalizeRepoPath(e.repoPath) === normalized);
    if (!entry) return null;
    try {
      return await this.getProject(entry.id);
    } catch {
      return null;
    }
  }

  /** Update project (name, repoPath, etc.) */
  async updateProject(
    id: string,
    updates: Partial<Project>
  ): Promise<{ project: Project; repoPathChanged: boolean }> {
    const project = await this.getProject(id);
    const repoPathChanged = updates.repoPath !== undefined && updates.repoPath !== project.repoPath;
    if (repoPathChanged && updates.repoPath) {
      assertSupportedRepoPath(updates.repoPath);
    }
    const updated = { ...project, ...updates, updatedAt: new Date().toISOString() };

    // Update global index if name or repoPath changed
    if (updates.name !== undefined || repoPathChanged) {
      const indexUpdates: { name?: string; repoPath?: string } = {};
      if (updates.name !== undefined) indexUpdates.name = updates.name;
      if (repoPathChanged) indexUpdates.repoPath = updates.repoPath;
      await projectIndex.updateProject(id, indexUpdates);
    }

    this.invalidateListCache();
    if (repoPathChanged) {
      projectGitRuntimeCache.invalidate(id);
    }
    return { project: updated, repoPathChanged };
  }

  /** Read project settings from global store. If missing, create defaults and return them. */
  async getSettings(projectId: string): Promise<ProjectSettings> {
    const repoPath = await this.getRepoPath(projectId);
    const defaults = buildDefaultSettings();
    const stored = await getSettingsFromStore(projectId, defaults);
    const gs = await getGlobalSettings();
    if (stored === defaults) {
      const detected = await detectTestFramework(repoPath);
      const canonicalDefaults = toCanonicalSettings(defaults) as unknown as Record<string, unknown>;
      delete canonicalDefaults.simpleComplexityAgent;
      delete canonicalDefaults.complexComplexityAgent;
      delete canonicalDefaults.lowComplexityAgent;
      delete canonicalDefaults.highComplexityAgent;
      canonicalDefaults.testFramework = detected?.framework ?? null;
      canonicalDefaults.testCommand =
        detected?.testCommand ?? (getTestCommandForFramework(null) || null);
      await setSettingsInStore(projectId, canonicalDefaults as unknown as ProjectSettings);
      return this.projectSettingsFromRaw(canonicalDefaults, gs);
    }
    const raw = await getRawSettingsRecord(projectId);
    return this.projectSettingsFromRaw(raw, gs);
  }

  async getSettingsWithRuntimeState(projectId: string): Promise<ProjectSettings> {
    const [settings, repoPath] = await Promise.all([
      this.getSettings(projectId),
      this.getRepoPath(projectId),
    ]);
    const preferredBaseBranch = settings.worktreeBaseBranch ?? "main";
    const runtime = projectGitRuntimeCache.getSnapshot(projectId, repoPath, preferredBaseBranch);
    const freq = settings.selfImprovementFrequency ?? "never";
    const nextRunAt =
      freq === "daily" || freq === "weekly"
        ? getNextScheduledSelfImprovementRunAt(freq)
        : undefined;
    return {
      ...settings,
      deployment: deploymentConfigForApiResponse(settings.deployment),
      worktreeBaseBranch: runtime.worktreeBaseBranch,
      gitRemoteMode: runtime.gitRemoteMode,
      gitRuntimeStatus: runtime.gitRuntimeStatus,
      ...(nextRunAt !== undefined && { nextRunAt }),
    };
  }

  /**
   * Compute project-specific validation timeout from manual override or adaptive history.
   * Scoped and full-suite runs keep separate rolling duration samples.
   */
  async getValidationTimeoutMs(projectId: string, scope: "scoped" | "full"): Promise<number> {
    const settings = await this.getSettings(projectId);
    if (typeof settings.validationTimeoutMsOverride === "number") {
      return clampValidationTimeoutMs(settings.validationTimeoutMsOverride);
    }

    const profile = settings.validationTimingProfile;
    const scoped = (profile?.scoped ?? []).filter((v): v is number => typeof v === "number");
    const full = (profile?.full ?? []).filter((v): v is number => typeof v === "number");
    const samples =
      scope === "scoped" ? (scoped.length > 0 ? scoped : full) : full.length > 0 ? full : scoped;

    if (samples.length === 0) {
      return DEFAULT_VALIDATION_TIMEOUT_MS;
    }

    const p95 = percentile(samples, 0.95);
    const adaptive = Math.round(p95 * VALIDATION_TIMEOUT_MULTIPLIER + VALIDATION_TIMEOUT_BUFFER_MS);
    return clampValidationTimeoutMs(adaptive);
  }

  /**
   * Record validation duration sample for adaptive timeout tuning.
   * Stored in project settings as a rolling window.
   */
  async recordValidationDuration(
    projectId: string,
    scope: "scoped" | "full",
    durationMs: number
  ): Promise<void> {
    const sample = normalizeValidationSample(durationMs);
    if (sample === null) return;

    const defaults = buildDefaultSettings();
    await updateSettingsInStore(projectId, defaults, (current) => {
      const rawSnapshot = current as unknown as Record<string, unknown>;
      const normalized = toCanonicalSettings(parseSettings(current));
      const existing = normalized.validationTimingProfile ?? {};
      const scopedSamples =
        scope === "scoped"
          ? [...(existing.scoped ?? []), sample].slice(-VALIDATION_TIMING_SAMPLE_LIMIT)
          : (existing.scoped ?? []);
      const fullSamples =
        scope === "full"
          ? [...(existing.full ?? []), sample].slice(-VALIDATION_TIMING_SAMPLE_LIMIT)
          : (existing.full ?? []);

      const merged = toCanonicalSettings({
        ...normalized,
        validationTimingProfile: {
          ...(scopedSamples.length > 0 && { scoped: scopedSamples }),
          ...(fullSamples.length > 0 && { full: fullSamples }),
          updatedAt: new Date().toISOString(),
        },
      });
      return omitInheritedAgentTiersForStore(
        merged as unknown as Record<string, unknown>,
        rawSnapshot
      ) as unknown as ProjectSettings;
    });
  }

  /** Update project settings (persisted in global store). */
  async updateSettings(
    projectId: string,
    updates: ProjectSettingsApiUpdate
  ): Promise<ProjectSettings> {
    await this.getRepoPath(projectId);
    const diskRaw = await getRawSettingsRecord(projectId);
    const gs = await getGlobalSettings();
    const workingRaw: Record<string, unknown> = { ...diskRaw };

    // Client cannot set self-improvement run metadata; only internal runs update these. nextRunAt is computed.
    const {
      selfImprovementLastRunAt: _stripLastRunAt,
      selfImprovementLastCommitSha: _stripLastSha,
      nextRunAt: _stripNextRunAt,
      validationTimingProfile: _stripValidationTimingProfile,
      maxTotalConcurrentAgents: maxTotalConcurrentAgentsUpdate,
      ...sanitizedUpdates
    } = updates as Partial<ProjectSettings> & {
      selfImprovementLastRunAt?: unknown;
      selfImprovementLastCommitSha?: unknown;
      nextRunAt?: unknown;
      validationTimingProfile?: unknown;
    };

    // Agent overrides: null clears project storage (inherit global); object sets explicit config; undefined leaves disk keys unchanged.
    const bodyLegacy = sanitizedUpdates as Partial<ProjectSettings> & {
      lowComplexityAgent?: unknown;
      highComplexityAgent?: unknown;
    };
    // Do not use ?? here: explicit `null` must clear overrides; ?? would skip null and fall through to legacy keys.
    const simpleUpdate = Object.prototype.hasOwnProperty.call(
      sanitizedUpdates,
      "simpleComplexityAgent"
    )
      ? sanitizedUpdates.simpleComplexityAgent
      : Object.prototype.hasOwnProperty.call(bodyLegacy, "lowComplexityAgent")
        ? bodyLegacy.lowComplexityAgent
        : undefined;
    const complexUpdate = Object.prototype.hasOwnProperty.call(
      sanitizedUpdates,
      "complexComplexityAgent"
    )
      ? sanitizedUpdates.complexComplexityAgent
      : Object.prototype.hasOwnProperty.call(bodyLegacy, "highComplexityAgent")
        ? bodyLegacy.highComplexityAgent
        : undefined;

    if (simpleUpdate === null) {
      delete workingRaw.simpleComplexityAgent;
      delete workingRaw.lowComplexityAgent;
    } else if (simpleUpdate !== undefined) {
      try {
        workingRaw.simpleComplexityAgent = parseAgentConfig(simpleUpdate, "simpleComplexityAgent");
        delete workingRaw.lowComplexityAgent;
      } catch (err) {
        const msg = getErrorMessage(err, "Invalid simple complexity agent configuration");
        throw new AppError(400, ErrorCodes.INVALID_AGENT_CONFIG, msg);
      }
    }

    if (complexUpdate === null) {
      delete workingRaw.complexComplexityAgent;
      delete workingRaw.highComplexityAgent;
    } else if (complexUpdate !== undefined) {
      try {
        workingRaw.complexComplexityAgent = parseAgentConfig(complexUpdate, "complexComplexityAgent");
        delete workingRaw.highComplexityAgent;
      } catch (err) {
        const msg = getErrorMessage(err, "Invalid complex complexity agent configuration");
        throw new AppError(400, ErrorCodes.INVALID_AGENT_CONFIG, msg);
      }
    }

    const current = this.projectSettingsFromRaw(workingRaw, gs);
    const simpleComplexityAgent = current.simpleComplexityAgent;
    const complexComplexityAgent = current.complexComplexityAgent;

    // Validate API keys in global store when agent config requires them (Claude API or Cursor)
    const agentConfigChanged = simpleUpdate !== undefined || complexUpdate !== undefined;
    const requiredProviders = agentConfigChanged
      ? getProvidersRequiringApiKeys([simpleComplexityAgent, complexComplexityAgent])
      : [];
    if (requiredProviders.length > 0) {
      const missing: ApiKeyProvider[] = [];
      for (const provider of requiredProviders) {
        const entries = gs.apiKeys?.[provider];
        if (!Array.isArray(entries) || entries.length === 0) {
          missing.push(provider);
        }
      }
      if (missing.length > 0) {
        throw new AppError(400, ErrorCodes.INVALID_AGENT_CONFIG, "Configure API keys in Settings.");
      }
    }

    const aiAutonomyLevel =
      typeof sanitizedUpdates.aiAutonomyLevel === "string" &&
      VALID_AI_AUTONOMY_LEVELS.includes(sanitizedUpdates.aiAutonomyLevel)
        ? sanitizedUpdates.aiAutonomyLevel
        : (current.aiAutonomyLevel ?? DEFAULT_AI_AUTONOMY_LEVEL);
    const hilConfig = hilConfigFromAiAutonomyLevel(aiAutonomyLevel);
    const gitWorkingMode =
      sanitizedUpdates.gitWorkingMode === "worktree" ||
      sanitizedUpdates.gitWorkingMode === "branches"
        ? sanitizedUpdates.gitWorkingMode
        : (current.gitWorkingMode ?? "worktree");
    const teamMembers =
      sanitizedUpdates.teamMembers !== undefined
        ? parseTeamMembers(sanitizedUpdates.teamMembers)
        : current.teamMembers;
    if (
      sanitizedUpdates.mergeStrategy !== undefined &&
      (typeof sanitizedUpdates.mergeStrategy !== "string" ||
        !VALID_MERGE_STRATEGIES.includes(sanitizedUpdates.mergeStrategy as "per_task" | "per_epic"))
    ) {
      throw new AppError(
        400,
        ErrorCodes.INVALID_INPUT,
        "Merge strategy must be “Per task” (merge to main after each task) or “Per epic” (merge to main when the whole epic is done)."
      );
    }
    const mergeStrategy =
      sanitizedUpdates.mergeStrategy !== undefined &&
      VALID_MERGE_STRATEGIES.includes(sanitizedUpdates.mergeStrategy as "per_task" | "per_epic")
        ? (sanitizedUpdates.mergeStrategy as "per_task" | "per_epic")
        : (current.mergeStrategy ?? "per_task");
    if (
      sanitizedUpdates.selfImprovementFrequency !== undefined &&
      (typeof sanitizedUpdates.selfImprovementFrequency !== "string" ||
        !VALID_SELF_IMPROVEMENT_FREQUENCIES.includes(
          sanitizedUpdates.selfImprovementFrequency as SelfImprovementFrequency
        ))
    ) {
      throw new AppError(
        400,
        ErrorCodes.INVALID_INPUT,
        "selfImprovementFrequency must be one of: never, after_each_plan, daily, weekly"
      );
    }
    const selfImprovementFrequency =
      sanitizedUpdates.selfImprovementFrequency !== undefined &&
      VALID_SELF_IMPROVEMENT_FREQUENCIES.includes(
        sanitizedUpdates.selfImprovementFrequency as SelfImprovementFrequency
      )
        ? (sanitizedUpdates.selfImprovementFrequency as SelfImprovementFrequency)
        : (current.selfImprovementFrequency ?? "never");
    const autoExecutePlans =
      sanitizedUpdates.autoExecutePlans !== undefined
        ? sanitizedUpdates.autoExecutePlans === true
        : (current.autoExecutePlans ?? false);
    if (
      sanitizedUpdates.runAgentEnhancementExperiments !== undefined &&
      typeof sanitizedUpdates.runAgentEnhancementExperiments !== "boolean"
    ) {
      throw new AppError(
        400,
        ErrorCodes.INVALID_INPUT,
        "runAgentEnhancementExperiments must be a boolean"
      );
    }
    const runAgentEnhancementExperiments =
      sanitizedUpdates.runAgentEnhancementExperiments !== undefined
        ? sanitizedUpdates.runAgentEnhancementExperiments === true
        : (current.runAgentEnhancementExperiments ?? false);
    if (
      sanitizedUpdates.validationTimeoutMsOverride !== undefined &&
      sanitizedUpdates.validationTimeoutMsOverride !== null &&
      (typeof sanitizedUpdates.validationTimeoutMsOverride !== "number" ||
        !Number.isFinite(sanitizedUpdates.validationTimeoutMsOverride))
    ) {
      throw new AppError(
        400,
        ErrorCodes.INVALID_INPUT,
        "validationTimeoutMsOverride must be a number (milliseconds) or null"
      );
    }
    if (
      typeof sanitizedUpdates.validationTimeoutMsOverride === "number" &&
      (sanitizedUpdates.validationTimeoutMsOverride < MIN_VALIDATION_TIMEOUT_MS ||
        sanitizedUpdates.validationTimeoutMsOverride > MAX_VALIDATION_TIMEOUT_MS)
    ) {
      throw new AppError(
        400,
        ErrorCodes.INVALID_INPUT,
        `validationTimeoutMsOverride must be between ${MIN_VALIDATION_TIMEOUT_MS} and ${MAX_VALIDATION_TIMEOUT_MS} milliseconds`
      );
    }
    const validationTimeoutMsOverride =
      sanitizedUpdates.validationTimeoutMsOverride === undefined
        ? (current.validationTimeoutMsOverride ?? null)
        : sanitizedUpdates.validationTimeoutMsOverride === null
          ? null
          : clampValidationTimeoutMs(sanitizedUpdates.validationTimeoutMsOverride);

    let maxTotalConcurrentAgents = current.maxTotalConcurrentAgents;
    if (maxTotalConcurrentAgentsUpdate !== undefined) {
      if (maxTotalConcurrentAgentsUpdate === null) {
        maxTotalConcurrentAgents = undefined;
      } else if (
        typeof maxTotalConcurrentAgentsUpdate === "number" &&
        Number.isFinite(maxTotalConcurrentAgentsUpdate) &&
        maxTotalConcurrentAgentsUpdate >= 1
      ) {
        maxTotalConcurrentAgents = Math.min(
          MAX_TOTAL_CONCURRENT_AGENTS_CAP,
          Math.max(1, Math.round(maxTotalConcurrentAgentsUpdate))
        );
      } else {
        throw new AppError(
          400,
          ErrorCodes.INVALID_INPUT,
          `maxTotalConcurrentAgents must be a number from 1 to ${MAX_TOTAL_CONCURRENT_AGENTS_CAP}, or null to clear`
        );
      }
    }

    const { deployment: deploymentPatch, ...sanitizedWithoutDeployment } = sanitizedUpdates;
    const mergedDeployment =
      deploymentPatch !== undefined
        ? mergeDeploymentConfigPatch(current.deployment, deploymentPatch)
        : current.deployment;

    const effectiveSettings: ProjectSettings = {
      ...current,
      ...sanitizedWithoutDeployment,
      simpleComplexityAgent,
      complexComplexityAgent,
      aiAutonomyLevel,
      hilConfig,
      gitWorkingMode,
      teamMembers,
      mergeStrategy,
      selfImprovementFrequency,
      autoExecutePlans,
      runAgentEnhancementExperiments,
      validationTimeoutMsOverride,
      maxTotalConcurrentAgents,
      deployment: mergedDeployment,
    };
    const updated: ProjectSettings = {
      ...effectiveSettings,
      // Branches mode forces maxConcurrentCoders=1 regardless of stored value
      ...(gitWorkingMode === "branches" && { maxConcurrentCoders: 1 }),
    };
    const {
      simpleComplexityAgentInherited: _stripSimpleInherited,
      complexComplexityAgentInherited: _stripComplexInherited,
      ...settingsForCanonical
    } = updated;
    const canonical = toCanonicalSettings(settingsForCanonical);
    const toPersist = omitInheritedAgentTiersForStore(
      canonical as unknown as Record<string, unknown>,
      workingRaw
    ) as unknown as ProjectSettings;
    await setSettingsInStore(projectId, toPersist);
    if ((toPersist.worktreeBaseBranch ?? "main") !== (current.worktreeBaseBranch ?? "main")) {
      projectGitRuntimeCache.invalidate(projectId);
    }
    return this.getSettingsWithRuntimeState(projectId);
  }

  /** Archive a project: remove from index only. Data in project folder remains. */
  async archiveProject(id: string): Promise<void> {
    await this.getProject(id); // validate exists, throws 404 if not
    await this.stopOrchestratorForProject(id);
    await this.taskStore.deleteOpenQuestionsByProjectId(id);
    await projectIndex.removeProject(id);
    this.invalidateListCache();
    projectGitRuntimeCache.invalidate(id);
  }

  /** Delete a project: remove all project data from global store and delete .opensprint directory. */
  async deleteProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    const repoPath = project.repoPath;
    await this.stopOrchestratorForProject(id);

    // Remove worktrees for this project so watchdog/orphan recovery never see them again.
    // Use listTaskWorktrees (from git) to find all worktrees regardless of tmpdir.
    const branchManager = new BranchManager();
    try {
      const worktrees = await branchManager.listTaskWorktrees(repoPath);
      for (const { taskId, worktreePath } of worktrees) {
        try {
          await branchManager.removeTaskWorktree(repoPath, taskId, worktreePath);
        } catch {
          // Best effort; worktree may already be gone
        }
      }
    } catch {
      // Repo may not exist or have no worktrees
    }

    await this.taskStore.deleteByProjectId(id);
    await deleteSettingsFromStore(id);
    await deleteFeedbackAssetsForProject(id);

    const opensprintPath = path.join(repoPath, OPENSPRINT_DIR);
    try {
      await fs.rm(opensprintPath, { recursive: true, force: true });
    } catch (err) {
      const msg = getErrorMessage(err);
      throw new AppError(500, ErrorCodes.INTERNAL_ERROR, `Failed to delete project data: ${msg}`, {
        projectId: id,
        repoPath,
      });
    }

    await projectIndex.removeProject(id);
    this.invalidateListCache();
    projectGitRuntimeCache.invalidate(id);
  }
}
