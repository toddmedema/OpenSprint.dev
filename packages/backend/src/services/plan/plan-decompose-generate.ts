/**
 * Decompose/generate helpers: plan-task summary for auto-review, PRD context string, parse decompose response.
 * Pure or thin helpers used by PlanService for suggest, decompose, generate-from-description, and task generation.
 */
import type { Plan, Prd, SuggestedPlan } from "@opensprint/shared";
import {
  normalizeDependsOnPlans,
  normalizePlanSpec,
  normalizePlannerTask,
} from "./planner-normalize.js";
import { extractJsonFromAgentResponse } from "../../utils/json-extract.js";
import { AppError } from "../../middleware/error-handler.js";
import { ErrorCodes } from "../../middleware/error-codes.js";

/** Build plan/task summary for the auto-review agent using pre-collected task data. */
export function buildPlanTaskSummaryFromCreated(
  createdPlans: Array<Plan & { _createdTaskIds?: string[]; _createdTaskTitles?: string[] }>
): string {
  const lines: string[] = [];
  for (const plan of createdPlans) {
    const epicId = plan.metadata.epicId;
    if (!epicId) continue;
    lines.push(`## Plan: ${plan.metadata.planId} (epic: ${epicId})`);
    const ids = plan._createdTaskIds ?? [];
    const titles = plan._createdTaskTitles ?? [];
    for (let i = 0; i < ids.length; i++) {
      lines.push(`- **${ids[i]}**: ${titles[i] ?? "Untitled task"}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Build PRD context string for agent prompts from a Prd object. */
export function buildPrdContextString(prd: Prd): string {
  let context = "";
  for (const [key, section] of Object.entries(prd.sections ?? {})) {
    if (section?.content) {
      context += `### ${key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}\n`;
      context += `${section.content}\n\n`;
    }
  }
  return context || "The PRD is currently empty.";
}

/**
 * Parse agent decomposition response into SuggestedPlan array.
 * Extracts JSON from response (may be wrapped in ```json ... ```).
 */
export function parseDecomposeResponse(content: string): SuggestedPlan[] {
  const parsed =
    extractJsonFromAgentResponse<{ plans?: unknown[]; plan_list?: unknown[] }>(content, "plans") ??
    extractJsonFromAgentResponse<{ plans?: unknown[]; plan_list?: unknown[] }>(
      content,
      "plan_list"
    );
  if (!parsed) {
    throw new AppError(
      400,
      ErrorCodes.DECOMPOSE_PARSE_FAILED,
      "Planning agent did not return valid decomposition JSON. Response: " + content.slice(0, 500),
      { responsePreview: content.slice(0, 500) }
    );
  }

  const rawSpecs = (parsed.plans ?? parsed.plan_list ?? []) as Array<Record<string, unknown>>;
  if (rawSpecs.length === 0) {
    throw new AppError(
      400,
      ErrorCodes.DECOMPOSE_EMPTY,
      "Planning agent returned no plans. Ensure the PRD has sufficient content."
    );
  }
  return rawSpecs.map((rawSpec) => {
    const spec = normalizePlanSpec(rawSpec);
    return {
      title: spec.title,
      content: spec.content,
      complexity: spec.complexity,
      dependsOnPlans: normalizeDependsOnPlans(rawSpec),
      mockups: spec.mockups,
      tasks: spec.tasks.map((t) => normalizePlannerTask(t, spec.tasks)),
    };
  }) as SuggestedPlan[];
}

export function parseDecomposeResponseOrNull(content: string): SuggestedPlan[] | null {
  try {
    return parseDecomposeResponse(content);
  } catch {
    return null;
  }
}

export function explainDecomposeResponseFailure(content: string): string | undefined {
  try {
    parseDecomposeResponse(content);
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.message : undefined;
  }
}
