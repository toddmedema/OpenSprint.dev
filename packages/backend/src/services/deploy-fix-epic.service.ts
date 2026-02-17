/**
 * Deploy fix epic service — PRD §7.5.2.
 * When pre-deploy tests fail, invokes the planning-slot agent (Planner role)
 * with test output to create a structured fix epic + task list.
 * Orchestrator creates the epic and sub-tasks via beads, closes the gate
 * so fix tasks enter the queue via bd ready.
 */

import fs from "fs/promises";
import path from "path";
import { BeadsService } from "./beads.service.js";
import { AgentClient } from "./agent-client.js";
import { ProjectService } from "./project.service.js";
import { gitCommitQueue } from "./git-commit-queue.service.js";
import { OPENSPRINT_PATHS } from "@opensprint/shared";

const projectService = new ProjectService();
const beads = new BeadsService();
const agentClient = new AgentClient();

const FIX_EPIC_SYSTEM_PROMPT = `You are the Planner agent for OpenSprint (PRD §12.3.2). Your task is to analyze failed test output and produce a structured list of fix tasks.

Given the raw test output from a pre-deployment test run, create an indexed task list to fix all errors and failures. Each task should:
1. Address a specific failing test or error
2. Be atomic (implementable in one coding session)
3. Have clear acceptance criteria (the test must pass after the fix)
4. Include dependencies where one fix blocks another (e.g., fix data model before API)

Respond with ONLY valid JSON in this exact format (you may wrap in a markdown json code block):
{
  "status": "success",
  "tasks": [
    {
      "index": 0,
      "title": "Fix task title",
      "description": "Detailed spec: what to fix, which files, acceptance criteria",
      "priority": 1,
      "depends_on": []
    },
    {
      "index": 1,
      "title": "Another fix task",
      "description": "...",
      "priority": 1,
      "depends_on": [0]
    }
  ]
}

priority: 0 (highest) to 4 (lowest). depends_on: array of task indices (0-based) this task is blocked by.
If you cannot parse meaningful fix tasks from the output, return: {"status": "failed", "tasks": []}`;

export interface CreateFixEpicResult {
  epicId: string;
  gateTaskId: string;
  taskCount: number;
}

/**
 * Invoke planning agent with test output, create fix epic and sub-tasks via beads.
 * Closes the gating task so fix tasks appear in bd ready.
 * Returns epic ID and metadata, or null on failure.
 */
export async function createFixEpicFromTestOutput(
  projectId: string,
  repoPath: string,
  testOutput: string,
): Promise<CreateFixEpicResult | null> {
  const settings = await projectService.getSettings(projectId);

  const prompt = `# Pre-deployment test failures — create fix tasks

The following test output was produced when running the test suite before deployment. All tests must pass before deployment can proceed.

Analyze the failures and create a structured list of fix tasks. Each task should address a specific failing test or error. Order tasks so that foundational fixes (e.g., schema, types) come before dependent fixes (e.g., API, components).

## Test output

\`\`\`
${testOutput.slice(0, 30000)}
\`\`\`

Output your response as JSON with status and tasks array.`;

  let response;
  try {
    response = await agentClient.invoke({
      config: settings.planningAgent,
      prompt,
      systemPrompt: FIX_EPIC_SYSTEM_PROMPT,
      cwd: repoPath,
    });
  } catch (err) {
    console.error("[deploy-fix-epic] Planning agent invocation failed:", err);
    return null;
  }

  const jsonMatch = response.content.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[deploy-fix-epic] Agent did not return valid JSON with tasks");
    return null;
  }

  let parsed: { status?: string; tasks?: Array<{ index?: number; title: string; description?: string; priority?: number; depends_on?: number[] }> };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.warn("[deploy-fix-epic] JSON parse failed");
    return null;
  }

  if (parsed.status !== "success" || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    console.warn("[deploy-fix-epic] Agent returned no tasks or failed status");
    return null;
  }

  const tasks = parsed.tasks;

  // Create epic
  const epicTitle = "Fix: pre-deploy test failures";
  const epicResult = await beads.create(repoPath, epicTitle, { type: "epic" });
  const epicId = epicResult.id;

  // Write minimal plan markdown so Coder has context (context-assembler reads epic description path)
  const planId = `fix-deploy-${Date.now()}`;
  const fixPlanPath = `${OPENSPRINT_PATHS.plans}/${planId}.md`;
  const plansDir = path.join(repoPath, OPENSPRINT_PATHS.plans);
  await fs.mkdir(plansDir, { recursive: true });
  const planContent = `# Fix: Pre-deploy Test Failures

## Overview

Pre-deployment tests failed. Fix each failing test or error as specified in the task descriptions.

## Test Output (reference)

\`\`\`
${testOutput.slice(0, 15000)}
\`\`\`

## Acceptance Criteria

- All tests pass (run \`npm test\` or project test command)
- No regressions in previously passing tests
`;
  await fs.writeFile(path.join(repoPath, fixPlanPath), planContent);
  await beads.update(repoPath, epicId, { description: fixPlanPath });

  // Create gating task
  const gateResult = await beads.create(repoPath, "Plan approval gate", {
    type: "task",
    parentId: epicId,
  });
  const gateTaskId = gateResult.id;

  // Create child tasks
  const taskIdMap = new Map<number, string>();

  for (const task of tasks) {
    const idx = task.index ?? tasks.indexOf(task);
    const priority = Math.min(4, Math.max(0, task.priority ?? 2));
    const taskResult = await beads.create(repoPath, task.title, {
      type: "task",
      description: task.description ?? "",
      priority,
      parentId: epicId,
    });
    taskIdMap.set(idx, taskResult.id);
    await beads.addDependency(repoPath, taskResult.id, gateTaskId);
  }

  // Add inter-task dependencies (depends_on uses indices)
  for (const task of tasks) {
    const idx = task.index ?? tasks.indexOf(task);
    const childId = taskIdMap.get(idx);
    const deps = task.depends_on ?? [];
    if (childId) {
      for (const parentIdx of deps) {
        const parentId = taskIdMap.get(parentIdx);
        if (parentId) {
          await beads.addDependency(repoPath, childId, parentId);
        }
      }
    }
  }

  // Close gate so fix tasks appear in bd ready
  await beads.close(repoPath, gateTaskId, "Fix epic approved for execution");

  // Persist beads and commit
  await gitCommitQueue.enqueue({
    type: "beads_export",
    repoPath,
    summary: "deploy fix epic created from test failures",
  });

  return {
    epicId,
    gateTaskId,
    taskCount: tasks.length,
  };
}
