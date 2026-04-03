/**
 * Plan markdown template and validation per PRD §7.2.3.
 * Each Plan markdown file follows a standardized template with required sections.
 */

/** Required section headings per PRD §7.2.3 (in order) */
export const PLAN_MARKDOWN_SECTIONS = [
  "Overview",
  "Assumptions",
  "Acceptance Criteria",
  "Technical Approach",
  "Dependencies",
  "Data Model Changes",
  "API Specification",
  "UI/UX Requirements",
  "Edge Cases and Error Handling",
  "Testing Strategy",
  "Estimated Complexity",
] as const;

export type PlanSectionName = (typeof PLAN_MARKDOWN_SECTIONS)[number];

/** Result of validating plan content against the template */
export interface PlanValidationResult {
  /** Section headings that are missing from the content */
  missing: PlanSectionName[];
  /** Warning messages (e.g., missing sections) */
  warnings: string[];
}

/**
 * Validates plan markdown content against the PRD §7.2.3 template structure.
 * Returns missing sections and warnings. Does NOT block — warn only.
 */
export function validatePlanContent(content: string): PlanValidationResult {
  const missing: PlanSectionName[] = [];
  const warnings: string[] = [];

  if (!content?.trim()) {
    return {
      missing: [...PLAN_MARKDOWN_SECTIONS],
      warnings: ["Plan content is empty"],
    };
  }

  const normalized = content.replace(/\r\n/g, "\n");
  for (const section of PLAN_MARKDOWN_SECTIONS) {
    // Match ## Section at start of line (section may have parenthetical, e.g. "Acceptance Criteria (with testable conditions)")
    const pattern = new RegExp(`^##\\s+${escapeRegex(section)}(?:\\s|\\(|$)`, "im");
    if (!pattern.test(normalized)) {
      missing.push(section);
    }
  }

  if (missing.length > 0) {
    warnings.push(`Plan is missing required sections (PRD §7.2.3): ${missing.join(", ")}`);
  }

  return { missing, warnings };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
