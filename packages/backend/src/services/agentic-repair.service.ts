/**
 * Agentic Repair Service — language-agnostic failure diagnosis and repair.
 *
 * Instead of hardcoded error fingerprints, this service:
 * 1. Builds a FailureDebugPacket from any gate/test/merge failure.
 * 2. Formats it as agent-consumable context for coder/reviewer/merger prompts.
 * 3. Parses the optional DebugArtifact from agent result payloads.
 *
 * The actual repair is performed by the agent itself (coder, reviewer, or merger)
 * within its normal execution. This service provides the structured context and
 * interprets the structured response.
 */

import type {
  DebugArtifact,
  FailureDebugPacket,
  RepairLoopOutcome,
  RootCauseCategory,
} from "@opensprint/shared";

const ROOT_CAUSE_CATEGORIES: readonly RootCauseCategory[] = [
  "code_defect",
  "env_defect",
  "tooling_defect",
  "dependency_defect",
  "external_blocker",
  "requirements_ambiguous",
  "unknown",
];

const SNIPPET_LIMIT = 3000;
const SUMMARY_LIMIT = 400;

function truncateSnippet(value: string | null | undefined, limit = SNIPPET_LIMIT): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit) + "\n... [truncated]";
}

/** Build a language-agnostic FailureDebugPacket from gate/test/merge failure context. */
export function buildFailureDebugPacket(params: {
  phase: "coding" | "review" | "merge";
  attempt: number;
  command: string | null;
  cwd: string | null;
  exitCode: number | null;
  signal: string | null;
  stdout: string | null;
  stderr: string | null;
  changedFiles: string[];
  gitDiffSummary: string | null;
  failureType: string;
  previousAttemptSummaries?: string[];
}): FailureDebugPacket {
  return {
    phase: params.phase,
    attempt: params.attempt,
    command: params.command,
    cwd: params.cwd,
    exitCode: params.exitCode,
    signal: params.signal,
    stdoutSnippet: truncateSnippet(params.stdout),
    stderrSnippet: truncateSnippet(params.stderr),
    changedFiles: params.changedFiles,
    gitDiffSummary: truncateSnippet(params.gitDiffSummary),
    failureType: params.failureType,
    previousAttemptSummaries: (params.previousAttemptSummaries ?? []).map((s) =>
      s.length > SUMMARY_LIMIT ? s.slice(0, SUMMARY_LIMIT) + "..." : s
    ),
  };
}

/**
 * Format a FailureDebugPacket as a markdown section for inclusion in agent prompts.
 * This replaces framework-specific remediation instructions with generic diagnostic context.
 */
export function formatDebugPacketForPrompt(packet: FailureDebugPacket): string {
  const lines: string[] = [
    "## Failure Context (Diagnose and Repair)",
    "",
    "A previous operation failed. Diagnose the root cause, apply a fix if possible, then verify.",
    "",
    `- **Phase:** ${packet.phase}`,
    `- **Attempt:** ${packet.attempt}`,
    `- **Failure type:** ${packet.failureType}`,
  ];

  if (packet.command) lines.push(`- **Failed command:** \`${packet.command}\``);
  if (packet.cwd) lines.push(`- **Working directory:** \`${packet.cwd}\``);
  if (packet.exitCode != null) lines.push(`- **Exit code:** ${packet.exitCode}`);
  if (packet.signal) lines.push(`- **Signal:** ${packet.signal}`);

  if (packet.stderrSnippet) {
    lines.push("", "### stderr", "```", packet.stderrSnippet, "```");
  }
  if (packet.stdoutSnippet) {
    lines.push("", "### stdout", "```", packet.stdoutSnippet, "```");
  }
  if (packet.changedFiles.length > 0) {
    lines.push("", "### Changed files", packet.changedFiles.map((f) => `- ${f}`).join("\n"));
  }
  if (packet.gitDiffSummary) {
    lines.push("", "### Git diff summary", "```", packet.gitDiffSummary, "```");
  }
  if (packet.previousAttemptSummaries.length > 0) {
    lines.push(
      "",
      "### Previous attempt summaries",
      ...packet.previousAttemptSummaries.map((s, i) => `${i + 1}. ${s}`)
    );
  }

  lines.push(
    "",
    "### Required response",
    "",
    "After diagnosing and attempting repair, include a `debugArtifact` field in your result JSON:",
    "```json",
    "{",
    '  "debugArtifact": {',
    '    "rootCauseCategory": "code_defect | env_defect | tooling_defect | dependency_defect | external_blocker | requirements_ambiguous | unknown",',
    '    "evidence": "What you found (error messages, file paths, config issues)",',
    '    "fixApplied": "What you changed to fix it, or null if unfixable",',
    '    "verificationCommand": "Command you ran to verify the fix, or null",',
    '    "verificationPassed": true,',
    '    "residualRisk": "Any remaining concerns, or null",',
    '    "nextAction": "continue | retry | escalate | block"',
    "  }",
    "}",
    "```",
    "",
    "The `debugArtifact` is optional but strongly encouraged. If you cannot diagnose the issue, set `rootCauseCategory` to `\"unknown\"` and `nextAction` to `\"escalate\"`.",
    ""
  );

  return lines.join("\n");
}

/** Parse a DebugArtifact from agent result JSON (best-effort, never throws). */
export function parseDebugArtifact(
  raw: Record<string, unknown> | null | undefined
): DebugArtifact | undefined {
  if (!raw) return undefined;
  const artifact = raw.debugArtifact ?? raw.debug_artifact;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return undefined;

  const a = artifact as Record<string, unknown>;
  const rootCause = String(a.rootCauseCategory ?? a.root_cause_category ?? "unknown")
    .trim()
    .toLowerCase() as RootCauseCategory;
  const validCategory = ROOT_CAUSE_CATEGORIES.includes(rootCause) ? rootCause : "unknown";

  const evidence = typeof a.evidence === "string" ? a.evidence.trim() : "";

  const fixApplied =
    typeof a.fixApplied === "string" || typeof a.fix_applied === "string"
      ? String(a.fixApplied ?? a.fix_applied).trim() || null
      : null;
  const verificationCommand =
    typeof a.verificationCommand === "string" || typeof a.verification_command === "string"
      ? String(a.verificationCommand ?? a.verification_command).trim() || null
      : null;
  const verificationPassed =
    typeof a.verificationPassed === "boolean"
      ? a.verificationPassed
      : typeof a.verification_passed === "boolean"
        ? a.verification_passed
        : null;
  const residualRisk =
    typeof a.residualRisk === "string" || typeof a.residual_risk === "string"
      ? String(a.residualRisk ?? a.residual_risk).trim() || null
      : null;

  const rawNextAction = String(a.nextAction ?? a.next_action ?? "continue")
    .trim()
    .toLowerCase();
  const validNextActions = ["continue", "retry", "escalate", "block"] as const;
  const nextAction = (
    validNextActions as readonly string[]
  ).includes(rawNextAction)
    ? (rawNextAction as DebugArtifact["nextAction"])
    : "escalate";

  const hasMeaningfulContent =
    evidence.length > 0 ||
    fixApplied != null ||
    verificationCommand != null ||
    verificationPassed != null ||
    residualRisk != null ||
    validCategory !== "unknown" ||
    nextAction !== "continue";
  if (!hasMeaningfulContent) return undefined;

  return {
    rootCauseCategory: validCategory,
    evidence: evidence || "No evidence provided.",
    fixApplied,
    verificationCommand,
    verificationPassed,
    residualRisk,
    nextAction,
  };
}

/**
 * Map a DebugArtifact's nextAction to a failure-handler policy suggestion.
 * The failure handler still makes the final decision, but this provides
 * agent-driven evidence for routing instead of fingerprint matching.
 */
export function suggestPolicyFromArtifact(
  artifact: DebugArtifact | null | undefined
): "continue" | "requeue" | "block" | "escalate" | null {
  if (!artifact) return null;

  switch (artifact.nextAction) {
    case "continue":
      return artifact.verificationPassed === true ? "continue" : "requeue";
    case "retry":
      return "requeue";
    case "escalate":
      return "escalate";
    case "block":
      return "block";
    default:
      return null;
  }
}

/** Summarize a DebugArtifact for event/session logging (single line). */
export function summarizeDebugArtifact(artifact: DebugArtifact | null | undefined): string | null {
  if (!artifact) return null;
  const fix = artifact.fixApplied ? `fix=${artifact.fixApplied.slice(0, 120)}` : "no-fix";
  const verified =
    artifact.verificationPassed === true
      ? "verified"
      : artifact.verificationPassed === false
        ? "verification-failed"
        : "unverified";
  return `[${artifact.rootCauseCategory}] ${fix} (${verified}, next=${artifact.nextAction})`;
}

/**
 * Build a RepairLoopOutcome from a single agent execution that included a debug packet.
 * In the current model, the agent itself performs repair within its normal run;
 * this function packages the outcome for telemetry/persistence.
 */
export function buildRepairLoopOutcome(params: {
  startedAt: number;
  debugArtifact: DebugArtifact | null;
  repairLog: string;
}): RepairLoopOutcome {
  const wallTimeMs = Math.max(0, Date.now() - params.startedAt);
  const passed = params.debugArtifact?.verificationPassed === true;

  return {
    iterations: 1,
    wallTimeMs,
    finalVerificationPassed: passed,
    debugArtifact: params.debugArtifact,
    repairLog: params.repairLog.slice(0, 5000),
  };
}
