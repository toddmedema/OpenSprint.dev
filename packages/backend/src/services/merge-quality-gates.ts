/**
 * Canonical quality-gate commands that must pass before merge-to-main.
 * Keep this list aligned with CI merge-gate workflow.
 */
const DEFAULT_MERGE_QUALITY_GATE_COMMANDS = ["npm run build", "npm run lint", "npm run test"];

export function getMergeQualityGateCommands(): string[] {
  return [...DEFAULT_MERGE_QUALITY_GATE_COMMANDS];
}
