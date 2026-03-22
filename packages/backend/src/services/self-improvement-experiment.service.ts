/**
 * Self-improvement experiment pipeline (mining replay-grade Execute sessions + candidate behavior bundles).
 * Replay-grade: archived session with completion metadata and an opensprint/* task branch (merge-style success path).
 */

import type { AgentRole } from "@opensprint/shared";
import { AGENT_ROLE_CANONICAL_ORDER } from "@opensprint/shared";
import type { AgentInstructionsService } from "./agent-instructions.service.js";
import { runBehaviorVersionStoreWrite } from "./behavior-version-store.service.js";
import { taskStore } from "./task-store.service.js";
import { toPgParams } from "../db/sql-params.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("self-improvement-experiment");

const REPLAY_GRADE_SESSION_SQL = toPgParams(`
  SELECT id FROM agent_sessions
  WHERE project_id = ?
    AND completed_at IS NOT NULL
    AND LOWER(TRIM(status)) IN ('success', 'approved')
    AND TRIM(git_branch) <> ''
    AND git_branch LIKE 'opensprint/%'
  ORDER BY id DESC
  LIMIT 500
`);

/** Baseline instruction + template bodies used to build experiment diffs. */
export interface BehaviorExperimentInstructionBaseline {
  general: string;
  roles: Partial<Record<AgentRole, string>>;
  templates: {
    coder: string;
    reviewer: string;
    finalReview: string;
    selfImprovement: string;
  };
}

export interface BehaviorExperimentCandidateBundle {
  versionType: "candidate";
  minedSessionIds: number[];
  runId: string;
  generalInstructionDiff: string;
  roleInstructionDiffs: Partial<Record<AgentRole, string>>;
  promptTemplateDiffs: {
    coder: string;
    reviewer: string;
    finalReview: string;
    selfImprovement: string;
  };
  createdAt: string;
}

const EXECUTE_ROLES: AgentRole[] = ["coder", "reviewer"];

/** Canonical prompt anchors (stable substrings; align with Execute / final review / self-improvement contracts). */
const TEMPLATE_SNIPPETS = {
  coder:
    'a JSON object like {"status":"success","summary":"..."} or {"status":"failed","summary":"..."}',
  reviewer:
    'a JSON object like {"status":"approved","summary":"..."} or {"status":"rejected","summary":"..."}',
  finalReview:
    '"status": "pass" | "issues"',
  selfImprovement:
    "Output MUST be one of:",
} as const;

function overlayAfterBase(base: string, overlay: string): string {
  const b = base.trimEnd();
  return b ? `${b}\n\n## Experiment candidate overlay\n${overlay}\n` : overlay;
}

function diffText(path: string, before: string, after: string): string {
  if (before.trim() === after.trim()) return "";
  const oldHead = before.split("\n").slice(0, 3).join("\n");
  const newTail = after.split("\n").slice(-8).join("\n");
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ ... @@",
    ...oldHead.split("\n").map((l) => ` ${l}`),
    ...newTail.split("\n").map((l) => `+${l}`),
  ].join("\n");
}

/**
 * Mine agent_sessions ids suitable for Execute replay (completed, branch under opensprint/).
 */
export async function mineReplayGradeExecuteSessionIds(projectId: string): Promise<number[]> {
  const client = await taskStore.getDb();
  const rows = await client.query(REPLAY_GRADE_SESSION_SQL, [projectId]);
  const ids: number[] = [];
  for (const row of rows) {
    const id = row.id;
    if (typeof id === "number" && Number.isFinite(id)) ids.push(id);
    else if (typeof id === "string" && /^\d+$/.test(id)) ids.push(Number(id));
  }
  return ids;
}

export async function buildBehaviorInstructionBaseline(
  projectId: string,
  instructions: AgentInstructionsService
): Promise<BehaviorExperimentInstructionBaseline> {
  const general = await instructions.getGeneralInstructions(projectId);
  const roles: Partial<Record<AgentRole, string>> = {};
  for (const role of AGENT_ROLE_CANONICAL_ORDER) {
    roles[role] = await instructions.getRoleInstructions(projectId, role);
  }
  return {
    general,
    roles,
    templates: { ...TEMPLATE_SNIPPETS },
  };
}

/**
 * Rule-based candidate: append high-signal experiment overlays and emit unified-diff style summaries.
 */
export function buildBehaviorExperimentCandidateBundle(params: {
  sessionIds: number[];
  baseline: BehaviorExperimentInstructionBaseline;
  runId: string;
}): BehaviorExperimentCandidateBundle {
  const { sessionIds, baseline, runId } = params;
  const createdAt = new Date().toISOString();

  const generalAfter = overlayAfterBase(
    baseline.general,
    "- Emphasize smallest relevant non-watch verification while iterating.\n- Prefer high-impact, low-risk instruction changes."
  );
  const generalInstructionDiff = diffText("AGENTS.md", baseline.general, generalAfter);

  const roleInstructionDiffs: Partial<Record<AgentRole, string>> = {};
  for (const role of EXECUTE_ROLES) {
    const prev = baseline.roles[role] ?? "";
    const next = overlayAfterBase(
      prev,
      role === "coder"
        ? "Prefer scoped verification commands while iterating."
        : "Keep review feedback actionable and tied to acceptance criteria."
    );
    const d = diffText(`.opensprint/agents/${role}.md`, prev, next);
    if (d) roleInstructionDiffs[role] = d;
  }

  const coderTplAfter = overlayAfterBase(
    baseline.templates.coder,
    "Prefer scoped verification while iterating; widen coverage only when the touched surface requires it."
  );
  const reviewerTplAfter = overlayAfterBase(
    baseline.templates.reviewer,
    "Reject only when acceptance criteria are unmet; cite concrete gaps."
  );
  const finalTplAfter = overlayAfterBase(
    baseline.templates.finalReview,
    "Weight task-success quality first; flag high-impact gaps only."
  );
  const selfTplAfter = overlayAfterBase(
    baseline.templates.selfImprovement,
    "Prioritize high-impact, well-scoped improvements with measurable outcomes."
  );

  return {
    versionType: "candidate",
    minedSessionIds: sessionIds,
    runId,
    generalInstructionDiff,
    roleInstructionDiffs,
    promptTemplateDiffs: {
      coder: diffText("templates/coder.md", baseline.templates.coder, coderTplAfter),
      reviewer: diffText("templates/reviewer.md", baseline.templates.reviewer, reviewerTplAfter),
      finalReview: diffText("templates/final-review.md", baseline.templates.finalReview, finalTplAfter),
      selfImprovement: diffText(
        "templates/self-improvement.md",
        baseline.templates.selfImprovement,
        selfTplAfter
      ),
    },
    createdAt,
  };
}

export class SelfImprovementExperimentService {
  constructor(private readonly instructions: AgentInstructionsService) {}

  /**
   * Mine sessions, build a rule-based candidate bundle, persist as behavior_versions (version_type candidate).
   */
  async generateAndPersistCandidate(
    projectId: string,
    runId: string
  ): Promise<{ versionId: string; bundle: BehaviorExperimentCandidateBundle }> {
    const sessionIds = await mineReplayGradeExecuteSessionIds(projectId);
    const baseline = await buildBehaviorInstructionBaseline(projectId, this.instructions);
    const bundle = buildBehaviorExperimentCandidateBundle({ sessionIds, baseline, runId });
    const versionId = `exp-${runId}`;

    await runBehaviorVersionStoreWrite(async (store) => {
      await store.saveCandidate(projectId, versionId, JSON.stringify(bundle));
    });

    log.info("Persisted behavior experiment candidate", {
      projectId,
      runId,
      versionId,
      minedCount: sessionIds.length,
    });

    return { versionId, bundle };
  }
}
