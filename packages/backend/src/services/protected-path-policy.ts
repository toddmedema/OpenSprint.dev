/**
 * Protected Path Policy — guards sensitive integration, OAuth, and token-handling
 * surfaces from unscoped modifications by Execute agents.
 *
 * Time: O(P * F) where P = number of protected patterns and F = number of changed files.
 * Space: O(1) auxiliary beyond input/output.
 */

export interface ProtectedPathPattern {
  /** Substring or prefix matched against file paths (case-insensitive). */
  pattern: string;
  /** Human-readable label for diagnostics. */
  label: string;
}

export interface ProtectedPathViolation {
  file: string;
  matchedPattern: ProtectedPathPattern;
}

export interface AuditResult {
  allowed: boolean;
  violations: ProtectedPathViolation[];
  /** True when the task scope explicitly unlocks protected paths. */
  scopeUnlocked: boolean;
}

export const PROTECTED_PATH_PATTERNS: ProtectedPathPattern[] = [
  { pattern: "routes/integrations-", label: "Integration routes" },
  { pattern: "integration-store", label: "Integration store service" },
  { pattern: "token-encryption", label: "Token encryption service" },
  { pattern: "routes/oauth", label: "OAuth routes" },
  { pattern: "todoist-sync", label: "Todoist sync service" },
];

/**
 * Keywords in a task title/description that unlock protected path edits.
 * Matched case-insensitively as substrings.
 */
export const SCOPE_UNLOCK_KEYWORDS: string[] = [
  "integration",
  "oauth",
  "todoist",
  "token-encrypt",
  "api-key-stor",
  "third-party-auth",
  "external-service",
  "connection-service",
  "connect-service",
];

/**
 * Check whether any of the changed files touch protected paths and whether
 * the task scope explicitly unlocks those paths.
 */
export function auditProtectedPaths(
  changedFiles: string[],
  taskTitle: string,
  taskDescription: string
): AuditResult {
  const scopeText = `${taskTitle}\n${taskDescription}`.toLowerCase();
  const scopeUnlocked = SCOPE_UNLOCK_KEYWORDS.some((kw) => scopeText.includes(kw));

  const violations: ProtectedPathViolation[] = [];
  for (const file of changedFiles) {
    const lower = file.toLowerCase();
    for (const pat of PROTECTED_PATH_PATTERNS) {
      if (lower.includes(pat.pattern)) {
        violations.push({ file, matchedPattern: pat });
        break;
      }
    }
  }

  return {
    allowed: scopeUnlocked || violations.length === 0,
    violations,
    scopeUnlocked,
  };
}

/**
 * Build a human-readable summary of protected-path violations for prompt injection
 * or reviewer feedback.
 */
export function formatViolationSummary(violations: ProtectedPathViolation[]): string {
  if (violations.length === 0) return "";
  const lines = violations.map(
    (v) => `- \`${v.file}\` — matches protected pattern "${v.matchedPattern.label}"`
  );
  return (
    "The following files are protected by the Protected Path Policy and " +
    "should not be modified unless the task explicitly scopes integration or OAuth work:\n" +
    lines.join("\n")
  );
}
