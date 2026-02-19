/**
 * Auditor agent service — PRD §12.3.6.
 * Summarizes current app capabilities from codebase snapshot and completed task history.
 * Invoked during Re-execute flow before Delta Planner.
 */

import { extractJsonFromAgentResponse } from "../utils/json-extract.js";

/** Auditor result.json format per PRD 12.3.6 */
export interface AuditorResult {
  status: "success" | "failed";
  capability_summary?: string;
}

/** Build the Auditor prompt per PRD 12.3.6 */
export function buildAuditorPrompt(planId: string, epicId: string): string {
  return `# Auditor: Summarize app capabilities for Re-execute

## Purpose
You are the Auditor agent for OpenSprint (PRD §12.3.6). Your task is to produce a structured summary of the application's current capabilities relevant to the Plan epic being re-built.

## Context
- Plan ID: ${planId}
- Epic ID: ${epicId}

## Input Files
You have been provided:
- \`context/file_tree.txt\` — the project's file/directory structure (excluding node_modules, .git, etc.)
- \`context/key_files/\` — contents of key source files (e.g. .ts, .tsx, .js, .jsx, .py, etc.)
- \`context/completed_tasks.json\` — the list of completed (closed) tasks for this epic with their titles, descriptions, and close reasons

## Task
Analyze the codebase and completed task history. Produce a structured markdown summary that covers:
1. **Implemented features** — what functionality exists in the codebase
2. **Data models** — schemas, types, entities
3. **API surface** — endpoints, routes, handlers
4. **UI components** — pages, screens, key components
5. **Integration points** — external services, config, environment

Focus on what is relevant to this Plan epic. Be concise but comprehensive enough for the Delta Planner to compare against the new Plan requirements.

## Output
Respond with ONLY valid JSON. No other text. Use this format:

{"status":"success","capability_summary":"<markdown content>"}

The capability_summary must be valid markdown. Use headers (##) for sections.`;
}

/** Parse Auditor result from agent response */
export function parseAuditorResult(content: string): AuditorResult | null {
  const parsed = extractJsonFromAgentResponse<AuditorResult>(content, "status");
  if (!parsed) return null;
  if (parsed.status === "success" && typeof parsed.capability_summary === "string") {
    return {
      status: "success",
      capability_summary: parsed.capability_summary.trim(),
    };
  }
  if (parsed.status === "failed") {
    return { status: "failed" };
  }
  return null;
}
