/**
 * Declarative workflow engine.
 *
 * Loads a WorkflowDefinition (from disk or built-in default), validates the
 * step graph, and resolves which step should execute next based on current
 * execution state. Replaces the hardcoded `idle → coding → review → done`
 * state machine with a configurable DAG.
 */

import fs from "fs/promises";
import path from "path";
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowExecutionState,
  StepStatus,
} from "@opensprint/shared";
import { OPENSPRINT_DIR } from "@opensprint/shared";
import { createLogger } from "../utils/logger.js";

const log = createLogger("workflow-engine");

/**
 * The default workflow encodes the current orchestrator behavior:
 * code (with tests) → review → merge.
 */
export const DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: "default",
  name: "Standard Code-Review-Merge",
  version: 1,
  steps: [
    {
      id: "code",
      name: "Coding",
      agentRole: "coder",
      dependsOn: [],
      successCondition: "tests_pass",
      retryPolicy: { maxAttempts: 6, escalateModel: true },
    },
    {
      id: "review",
      name: "Code Review",
      agentRole: "reviewer",
      dependsOn: ["code"],
      successCondition: "review_approved",
      retryPolicy: { maxAttempts: 4, escalateModel: false },
    },
    {
      id: "merge",
      name: "Merge to Main",
      agentRole: "merger",
      dependsOn: ["review"],
      successCondition: "merge_clean",
      retryPolicy: { maxAttempts: 3, escalateModel: false },
    },
  ],
};

export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[]
  ) {
    super(`Workflow validation failed: ${message}`);
    this.name = "WorkflowValidationError";
  }
}

export class WorkflowEngineService {
  /**
   * Load a workflow definition from the project's `.opensprint/workflow.json`,
   * falling back to the built-in default.
   */
  async loadWorkflow(repoPath: string): Promise<WorkflowDefinition> {
    const workflowPath = path.join(repoPath, OPENSPRINT_DIR, "workflow.json");
    try {
      const raw = await fs.readFile(workflowPath, "utf-8");
      const workflow = JSON.parse(raw) as WorkflowDefinition;
      this.validate(workflow);
      log.info("Loaded custom workflow", { id: workflow.id, steps: workflow.steps.length });
      return workflow;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return DEFAULT_WORKFLOW;
      }
      if (err instanceof WorkflowValidationError) throw err;
      log.warn("Failed to load custom workflow, using default", { err });
      return DEFAULT_WORKFLOW;
    }
  }

  /**
   * Validate a workflow definition:
   *  1. At least one step
   *  2. No duplicate step IDs
   *  3. All dependency references point to existing steps
   *  4. No dependency cycles
   */
  validate(workflow: WorkflowDefinition): void {
    const issues: string[] = [];

    if (!workflow.steps || workflow.steps.length === 0) {
      issues.push("Workflow must have at least one step");
    }

    const ids = new Set<string>();
    for (const step of workflow.steps) {
      if (ids.has(step.id)) {
        issues.push(`Duplicate step ID: ${step.id}`);
      }
      ids.add(step.id);
    }

    for (const step of workflow.steps) {
      for (const dep of step.dependsOn) {
        if (!ids.has(dep)) {
          issues.push(`Step "${step.id}" depends on non-existent step "${dep}"`);
        }
      }
    }

    const cycle = this.detectCycle(workflow.steps);
    if (cycle) {
      issues.push(`Dependency cycle detected: ${cycle.join(" → ")}`);
    }

    if (issues.length > 0) {
      throw new WorkflowValidationError(issues[0], issues);
    }
  }

  /**
   * Get the topologically sorted order of steps.
   * Throws if the graph has a cycle.
   */
  topologicalSort(workflow: WorkflowDefinition): WorkflowStep[] {
    this.validate(workflow);

    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));
    const visited = new Set<string>();
    const sorted: WorkflowStep[] = [];

    const visit = (id: string, stack: Set<string>): void => {
      if (visited.has(id)) return;
      stack.add(id);
      const step = stepMap.get(id)!;
      for (const dep of step.dependsOn) {
        visit(dep, stack);
      }
      stack.delete(id);
      visited.add(id);
      sorted.push(step);
    };

    for (const step of workflow.steps) {
      visit(step.id, new Set());
    }

    return sorted;
  }

  /**
   * Initialize execution state for a new task.
   * All steps start as "pending".
   */
  initExecutionState(workflow: WorkflowDefinition, taskId: string): WorkflowExecutionState {
    const stepStates: Record<string, StepStatus> = {};
    for (const step of workflow.steps) {
      stepStates[step.id] = "pending";
    }
    return {
      workflowId: workflow.id,
      taskId,
      stepStates,
      currentStepId: null,
    };
  }

  /**
   * Determine the next step to execute based on current state.
   * A step is "ready" when all its dependencies are "completed".
   * Returns null when all steps are done or the workflow is stuck.
   */
  getNextStep(workflow: WorkflowDefinition, state: WorkflowExecutionState): WorkflowStep | null {
    const sorted = this.topologicalSort(workflow);

    for (const step of sorted) {
      if (state.stepStates[step.id] !== "pending") continue;

      const depsCompleted = step.dependsOn.every((dep) => state.stepStates[dep] === "completed");
      if (depsCompleted) return step;
    }

    return null;
  }

  /**
   * Check if the workflow is fully complete (all steps completed or skipped).
   */
  isComplete(state: WorkflowExecutionState): boolean {
    return Object.values(state.stepStates).every((s) => s === "completed" || s === "skipped");
  }

  /**
   * Check if the workflow is stuck (no step is runnable but not all complete).
   */
  isStuck(workflow: WorkflowDefinition, state: WorkflowExecutionState): boolean {
    if (this.isComplete(state)) return false;
    if (state.currentStepId && state.stepStates[state.currentStepId] === "in_progress") {
      return false;
    }
    return this.getNextStep(workflow, state) === null;
  }

  /**
   * Detect cycles using DFS. Returns the cycle path or null if none found.
   */
  private detectCycle(steps: WorkflowStep[]): string[] | null {
    const adjList = new Map<string, string[]>();
    for (const step of steps) {
      adjList.set(step.id, step.dependsOn);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    const dfs = (id: string): string[] | null => {
      if (inStack.has(id)) {
        const cycleStart = path.indexOf(id);
        return [...path.slice(cycleStart), id];
      }
      if (visited.has(id)) return null;

      visited.add(id);
      inStack.add(id);
      path.push(id);

      for (const dep of adjList.get(id) ?? []) {
        const cycle = dfs(dep);
        if (cycle) return cycle;
      }

      inStack.delete(id);
      path.pop();
      return null;
    };

    for (const step of steps) {
      const cycle = dfs(step.id);
      if (cycle) return cycle;
    }

    return null;
  }
}

export const workflowEngineService = new WorkflowEngineService();
