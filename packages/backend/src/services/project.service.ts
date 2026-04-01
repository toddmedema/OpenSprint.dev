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
import {
  OPENSPRINT_DIR,
  SPEC_MD,
  prdToSpecMarkdown,
  DEFAULT_AI_AUTONOMY_LEVEL,
  DEFAULT_DEPLOYMENT_CONFIG,
  DEFAULT_REVIEW_MODE,
  getTestCommandForFramework,
  MAX_TOTAL_CONCURRENT_AGENTS_CAP,
  MIN_VALIDATION_TIMEOUT_MS,
  MAX_VALIDATION_TIMEOUT_MS,
  parseSettings,
  parseTeamMembers,
  getProvidersRequiringApiKeys,
  DEFAULT_AGENT_CONFIG,
  omitInheritedAgentTiersForStore,
  VALID_MERGE_STRATEGIES,
  VALID_SELF_IMPROVEMENT_FREQUENCIES,
  mergeDeploymentConfigPatch,
  deploymentConfigForApiResponse,
  hilConfigFromAiAutonomyLevel,
} from "@opensprint/shared";
import type { SelfImprovementFrequency } from "@opensprint/shared";
import type { ApiKeyProvider } from "@opensprint/shared";
import { getGlobalSettings } from "./global-settings.service.js";
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
import { worktreeCleanupIntentService } from "./worktree-cleanup-intent.service.js";
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
import { runGit } from "../utils/git-command.js";
import {
  ensureGitIdentityConfigured,
  ensureBaseBranchExists,
  ensureRepoHasInitialCommit,
  inspectGitRepoState,
} from "../utils/git-repo-state.js";
import {
  ensureExpoReactTypeDevDependencies,
  ensureExpoLintMergeGateTooling,
} from "../utils/scaffold-expo-deps.js";
import { getMergeQualityGateCommands } from "./merge-quality-gates.js";
import { getNextScheduledSelfImprovementRunAt } from "./project/project-scheduling.js";
import { normalizeDeployment } from "./project/project-deployment-normalize.js";
import {
  ensureOpenSprintRuntimeContract,
  ensureProjectGitignoreEntries,
} from "./project/project-runtime-contract.js";
import {
  buildDefaultSettings,
  clampValidationTimeoutMs,
  DEFAULT_VALIDATION_TIMEOUT_MS,
  extractNpmRunScriptName,
  isPreferredRepoPathEntry,
  normalizeRepoPath,
  normalizeValidationSample,
  percentile,
  resolveAiAutonomyAndHil,
  toCanonicalSettings,
  VALID_AI_AUTONOMY_LEVELS,
  VALIDATION_TIMING_SAMPLE_LIMIT,
  VALIDATION_TIMEOUT_BUFFER_MS,
  VALIDATION_TIMEOUT_MULTIPLIER,
} from "./project/project-settings-helpers.js";
import { projectSettingsFromRaw } from "./project/project-settings-from-raw.js";
import { commitBootstrapRepoChanges } from "./project/project-bootstrap-git.js";
import { resolvePreferredProjectEntry } from "./project/project-index-preference.js";
import {
  checkScaffoldPrerequisites,
  runScaffoldCommandWithRecovery,
} from "./project/project-scaffold-recovery.js";

export { getNextScheduledSelfImprovementRunAt } from "./project/project-scheduling.js";

const execAsync = promisify(exec);
const log = createLogger("project");

export class ProjectService {
  private taskStore = taskStoreSingleton;
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
        await ensureProjectGitignoreEntries(repoPath);
        const existing = await resolvePreferredProjectEntry(existingEntries);
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
      await ensureProjectGitignoreEntries(repoPath);
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
      await runGit(["rev-parse", "--is-inside-work-tree"], { cwd: repoPath });
    } catch {
      await runGit(["init"], { cwd: repoPath });
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

    // PRD §5.9: Add runtime/worktree paths to .gitignore during setup.
    await ensureProjectGitignoreEntries(repoPath);

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
      ...(input.toolchainProfile && { toolchainProfile: input.toolchainProfile }),
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

    await commitBootstrapRepoChanges(repoPath, {
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

    const prereq = await checkScaffoldPrerequisites();
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
      const scaffoldResult = await runScaffoldCommandWithRecovery(
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
      const installResult = await runScaffoldCommandWithRecovery(
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
      const tsResult = await runScaffoldCommandWithRecovery(
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

      const lintAfterScaffold = await runScaffoldCommandWithRecovery(
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
        const typecheckResult = await runScaffoldCommandWithRecovery(
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
        const packageJson = JSON.parse(packageJsonRaw) as {
          scripts?: Record<string, unknown>;
        } | null;
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
        const gateResult = await runScaffoldCommandWithRecovery(
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
      return projectSettingsFromRaw(canonicalDefaults, gs);
    }
    const raw = await getRawSettingsRecord(projectId);
    return projectSettingsFromRaw(raw, gs);
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
        workingRaw.complexComplexityAgent = parseAgentConfig(
          complexUpdate,
          "complexComplexityAgent"
        );
        delete workingRaw.highComplexityAgent;
      } catch (err) {
        const msg = getErrorMessage(err, "Invalid complex complexity agent configuration");
        throw new AppError(400, ErrorCodes.INVALID_AGENT_CONFIG, msg);
      }
    }

    const current = projectSettingsFromRaw(workingRaw, gs);
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
    const project = await this.getProject(id); // validate exists, throws 404 if not
    const repoPath = project.repoPath;
    await this.stopOrchestratorForProject(id);
    await this.cleanupProjectWorktrees(repoPath);
    await worktreeCleanupIntentService.clearProject(repoPath, id).catch(() => {});
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
    await this.cleanupProjectWorktrees(repoPath);
    await worktreeCleanupIntentService.clearProject(repoPath, id).catch(() => {});

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

  private async cleanupProjectWorktrees(repoPath: string): Promise<void> {
    const branchManager = new BranchManager();
    let removed = 0;
    let failed = 0;
    try {
      const worktrees = await branchManager.listTaskWorktrees(repoPath);
      for (const { taskId, worktreePath } of worktrees) {
        try {
          await branchManager.removeTaskWorktree(repoPath, taskId, worktreePath);
          removed += 1;
        } catch {
          failed += 1;
        }
      }
    } catch {
      // Repo may not exist or have no worktrees
    }
    if (removed > 0 || failed > 0) {
      log.info("Project worktree cleanup completed", { repoPath, removed, failed });
    }
  }
}
