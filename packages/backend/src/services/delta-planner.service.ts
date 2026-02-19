/**
 * Delta Planner agent service — PRD §12.3.7.
 * Compares old and new Plan versions against Auditor's capability summary;
 * generates only the delta tasks needed.
 */

import { extractJsonFromAgentResponse } from "../utils/json-extract.js";

/** Delta task format — same as Planner (PRD §12.3.2) */
export interface DeltaTask {
  index: number;
  title: string;
  description: string;
  priority?: number;
  depends_on?: number[];
}

/** Delta Planner result.json format per PRD 12.3.7 */
export interface DeltaPlannerResult {
  status: "success" | "no_changes_needed" | "failed";
  tasks?: DeltaTask[];
}

/** Build the Delta Planner prompt per PRD 12.3.7 */
export function buildDeltaPlannerPrompt(planId: string, epicId: string): string {
  return `# Delta Planner: Generate delta tasks for Re-execute

## Purpose
You are the Delta Planner agent for OpenSprint (PRD §12.3.7). Your task is to compare the original Plan (as it was when last executed) with the updated Plan, using the Auditor's capability summary to understand what already exists. Output ONLY the delta tasks — work that is still needed to fulfill the new Plan.

## Context
- Plan ID: ${planId}
- Epic ID: ${epicId}

## Input Files
You have been provided:
- \`context/plan_old.md\` — the Plan as it was when last executed (produced the current implementation)
- \`context/plan_new.md\` — the updated Plan (current file, user may have edited)
- \`context/capability_summary.md\` — the Auditor's summary of what is already implemented

## Task
1. Compare plan_old and plan_new to identify what changed
2. Cross-reference with capability_summary to determine what already exists
3. Produce an indexed task list for ONLY the delta work — tasks that are needed to go from current state to the new Plan requirements
4. If the new Plan adds requirements, create tasks for them
5. If the new Plan removes or simplifies requirements, no tasks needed for removals
6. If nothing has changed or the new Plan is fully satisfied by current capabilities, return no_changes_needed

## Output
Respond with ONLY valid JSON. No other text.

**If delta tasks are needed:**
{"status":"success","tasks":[{"index":0,"title":"Task title","description":"Detailed spec","priority":1,"depends_on":[]}]}

- index: 0-based ordinal for dependency resolution
- title: Clear, specific action
- description: Detailed spec with acceptance criteria
- priority: 0 (highest) to 4 (lowest)
- depends_on: array of indices (0-based) this task depends on — use [] if none

**If no work is needed (plan unchanged or fully satisfied):**
{"status":"no_changes_needed"}

Tasks must be atomic and implementable in one agent session. Resolve depends_on by index (e.g. depends_on: [0, 2] means this task blocks on tasks at index 0 and 2).`;
}

/** Parse Delta Planner result from agent response */
export function parseDeltaPlannerResult(content: string): DeltaPlannerResult | null {
  const parsed = extractJsonFromAgentResponse<DeltaPlannerResult>(content, "status");
  if (!parsed) return null;
  const status = parsed.status?.toLowerCase();
  if (status === "no_changes_needed") {
    return { status: "no_changes_needed" };
  }
  if (status === "failed") {
    return { status: "failed" };
  }
  if (status === "success" && Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
    return {
      status: "success",
      tasks: parsed.tasks.map((t) => ({
        index: typeof t.index === "number" ? t.index : 0,
        title: String(t.title ?? "").trim(),
        description: String(t.description ?? "").trim(),
        priority: typeof t.priority === "number" ? Math.min(4, Math.max(0, t.priority)) : 2,
        depends_on: Array.isArray(t.depends_on) ? t.depends_on.filter((d) => typeof d === "number") : [],
      })),
    };
  }
  if (status === "success" && (!parsed.tasks || parsed.tasks.length === 0)) {
    return { status: "no_changes_needed" };
  }
  return null;
}
