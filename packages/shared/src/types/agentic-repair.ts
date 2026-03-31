/**
 * Types for the agentic failure recovery system.
 *
 * FailureDebugPacket: language-agnostic context handed to an agent for diagnosis/repair.
 * DebugArtifact: structured report returned by an agent after a repair attempt.
 * RepairLoopConfig: budget/safety constraints for bounded repair iterations.
 */

/** Language-agnostic failure context passed to any repair-capable agent. */
export interface FailureDebugPacket {
  phase: "coding" | "review" | "merge";
  attempt: number;
  command: string | null;
  cwd: string | null;
  exitCode: number | null;
  signal: string | null;
  stdoutSnippet: string | null;
  stderrSnippet: string | null;
  changedFiles: string[];
  gitDiffSummary: string | null;
  failureType: string;
  previousAttemptSummaries: string[];
}

/**
 * Root-cause taxonomy reported by agents after diagnosis.
 * Orchestrator uses this for routing (requeue vs block vs escalate)
 * without needing framework-specific fingerprints.
 */
export type RootCauseCategory =
  | "code_defect"
  | "env_defect"
  | "tooling_defect"
  | "dependency_defect"
  | "external_blocker"
  | "requirements_ambiguous"
  | "unknown";

/** Structured report an agent returns after a repair attempt. */
export interface DebugArtifact {
  rootCauseCategory: RootCauseCategory;
  evidence: string;
  fixApplied: string | null;
  verificationCommand: string | null;
  verificationPassed: boolean | null;
  residualRisk: string | null;
  nextAction: "continue" | "retry" | "escalate" | "block";
}

/** Budget/safety constraints for a bounded repair loop. */
export interface RepairLoopConfig {
  maxIterations: number;
  maxWallTimeMs: number;
  maxCommands: number;
  allowDestructiveCommands: boolean;
}

/** Outcome of one repair loop execution. */
export interface RepairLoopOutcome {
  iterations: number;
  wallTimeMs: number;
  finalVerificationPassed: boolean;
  debugArtifact: DebugArtifact | null;
  repairLog: string;
}

/** Default repair loop budgets. */
export const DEFAULT_REPAIR_LOOP_CONFIG: RepairLoopConfig = {
  maxIterations: 2,
  maxWallTimeMs: 10 * 60 * 1000,
  maxCommands: 20,
  allowDestructiveCommands: false,
};
