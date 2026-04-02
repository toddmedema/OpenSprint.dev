/**
 * Structured failure fingerprinting for merge-attempt failures.
 *
 * Fingerprints group failures by {failureClass, normalizedMessage, phase, branch}
 * so the retry circuit breaker can detect repeated identical infrastructure failures.
 */

import crypto from "crypto";

export type FailureClass = "environment_setup" | "code_quality" | "merge_conflict" | "unknown";

export interface FailureFingerprint {
  hash: string;
  failureClass: FailureClass;
  normalizedMessage: string;
  phase: string;
  branch: string;
  raw: string;
}

/**
 * Normalize a failure message by stripping volatile content (paths, timestamps,
 * PIDs) so structurally identical failures hash to the same fingerprint.
 */
function normalizeMessage(raw: string): string {
  return raw
    .replace(/\/private\/var\/folders\/[^\s:]+/g, "<tmpdir>")
    .replace(/\/tmp\/[^\s:]+/g, "<tmpdir>")
    .replace(/\/var\/folders\/[^\s:]+/g, "<tmpdir>")
    .replace(/\.opensprint\/runtime\/worktrees\/[^\s/:]+/g, ".opensprint/runtime/worktrees/<task>")
    .replace(/opensprint-worktrees\/[^\s/:]+/g, "opensprint-worktrees/<task>")
    .replace(/os-[0-9a-f]{4,}/g, "<task-id>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<timestamp>")
    .replace(/pid:\s*\d+/g, "pid:<PID>")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyFailure(reason: string, category?: string): FailureClass {
  if (category === "environment_setup") return "environment_setup";
  if (category === "quality_gate") return "code_quality";

  const lower = reason.toLowerCase();
  if (
    lower.includes("package.json is missing") ||
    lower.includes("node_modules is missing") ||
    lower.includes("workspace is missing") ||
    lower.includes("directory does not exist") ||
    lower.includes(".git entry is missing") ||
    lower.includes("integrity check failed")
  ) {
    return "environment_setup";
  }
  if (lower.includes("conflict") || lower.includes("rebase")) {
    return "merge_conflict";
  }
  if (lower.includes("lint") || lower.includes("test") || lower.includes("build failed")) {
    return "code_quality";
  }
  return "unknown";
}

export function buildFailureFingerprint(
  reason: string,
  phase: string,
  branch: string,
  category?: string
): FailureFingerprint {
  const failureClass = classifyFailure(reason, category);
  const normalizedMessage = normalizeMessage(reason);
  const hashInput = `${failureClass}|${normalizedMessage}|${phase}|${branch}`;
  const hash = crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 16);

  return {
    hash,
    failureClass,
    normalizedMessage,
    phase,
    branch,
    raw: reason,
  };
}
