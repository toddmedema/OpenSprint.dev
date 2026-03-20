/**
 * Plan complexity evaluation: agent-based evaluation of plan implementation complexity.
 * Returns "medium" on parse failure. Used by PlanCrudService when createPlan does not receive complexity.
 */
import type { PlanComplexity } from "@opensprint/shared";
import { getAgentForPlanningRole } from "@opensprint/shared";
import { VALID_COMPLEXITIES } from "./plan/plan-prompts.js";
import { COMPLEXITY_EVALUATION_SYSTEM_PROMPT } from "./plan/plan-prompts.js";
import { ProjectService } from "./project.service.js";
import { getCombinedInstructions } from "./agent-instructions.service.js";
import { extractJsonFromAgentResponse } from "../utils/json-extract.js";
import { invokeStructuredPlanningAgent } from "./structured-agent-output.service.js";

export interface PlanComplexityEvaluationDeps {
  projectService: ProjectService;
}

export class PlanComplexityEvaluationService {
  constructor(private deps: PlanComplexityEvaluationDeps) {}

  private async getRepoPath(projectId: string): Promise<string> {
    const project = await this.deps.projectService.getProject(projectId);
    return project.repoPath;
  }

  /**
   * Evaluate plan complexity using the planning agent. Returns "medium" on parse failure.
   */
  async evaluateComplexity(
    projectId: string,
    title: string,
    content: string
  ): Promise<PlanComplexity> {
    const repoPath = await this.getRepoPath(projectId);
    const settings = await this.deps.projectService.getSettings(projectId);

    const prompt = `Evaluate the implementation complexity of this feature plan.\n\n## Title\n${title}\n\n## Content\n${content}`;

    const agentId = `plan-complexity-${projectId}-${Date.now()}`;

    const systemPrompt = `${COMPLEXITY_EVALUATION_SYSTEM_PROMPT}\n\n${await getCombinedInstructions(repoPath, "planner")}`;
    const response = await invokeStructuredPlanningAgent({
      projectId,
      role: "planner",
      config: getAgentForPlanningRole(settings, "planner"),
      messages: [{ role: "user", content: prompt }],
      systemPrompt,
      cwd: repoPath,
      tracking: {
        id: agentId,
        projectId,
        phase: "plan",
        role: "planner",
        label: "Complexity evaluation",
      },
      contract: {
        parse: (content) =>
          extractJsonFromAgentResponse<{ complexity?: string }>(content, "complexity"),
        repairPrompt:
          'Return valid JSON only in this shape: {"complexity":"low|medium|high|very_high"}',
        onExhausted: () => ({ complexity: "medium" }),
      },
    });

    const parsed = response.parsed;
    if (parsed) {
      const c = parsed.complexity;
      if (c && VALID_COMPLEXITIES.includes(c as PlanComplexity)) {
        return c as PlanComplexity;
      }
    }
    return "medium";
  }
}
