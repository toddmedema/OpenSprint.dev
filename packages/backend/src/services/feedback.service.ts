import fs from 'fs/promises';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { FeedbackItem, FeedbackSubmitRequest, FeedbackCategory } from '@opensprint/shared';
import { OPENSPRINT_PATHS } from '@opensprint/shared';
import { AppError } from '../middleware/error-handler.js';
import { ProjectService } from './project.service.js';
import { AgentClient } from './agent-client.js';
import { hilService } from './hil-service.js';
import { ChatService } from './chat.service.js';
import { PlanService } from './plan.service.js';
import { PrdService } from './prd.service.js';
import { broadcastToProject } from '../websocket/index.js';

const FEEDBACK_CATEGORIZATION_PROMPT = `You are an AI assistant that categorizes user feedback about a software product.

Given the user's feedback text, the PRD (Product Requirements Document), and available plans, determine:
1. The category: "bug" (something broken), "feature" (new capability request), "ux" (usability improvement), or "scope" (fundamental change to requirements)
2. Which feature/plan it relates to (if identifiable) — use the planId from the available plans list
3. One or more suggested task titles to address the feedback (array of strings)

Respond in JSON format:
{
  "category": "bug" | "feature" | "ux" | "scope",
  "mappedPlanId": "plan-id-if-identifiable or null",
  "task_titles": ["Short task title 1", "Short task title 2"]
}`;

export class FeedbackService {
  private projectService = new ProjectService();
  private agentClient = new AgentClient();
  private hilService = hilService;
  private chatService = new ChatService();
  private planService = new PlanService();
  private prdService = new PrdService();

  /** Get feedback directory for a project */
  private async getFeedbackDir(projectId: string): Promise<string> {
    const project = await this.projectService.getProject(projectId);
    return path.join(project.repoPath, OPENSPRINT_PATHS.feedback);
  }

  /** Atomic JSON write */
  private async writeJson(filePath: string, data: unknown): Promise<void> {
    const tmpPath = filePath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  /** List all feedback items */
  async listFeedback(projectId: string): Promise<FeedbackItem[]> {
    const feedbackDir = await this.getFeedbackDir(projectId);
    const items: FeedbackItem[] = [];

    try {
      const files = await fs.readdir(feedbackDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const data = await fs.readFile(path.join(feedbackDir, file), 'utf-8');
          items.push(JSON.parse(data) as FeedbackItem);
        }
      }
    } catch {
      // No feedback yet
    }

    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Submit new feedback with AI categorization and mapping */
  async submitFeedback(
    projectId: string,
    body: FeedbackSubmitRequest,
  ): Promise<FeedbackItem> {
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      throw new AppError(400, 'INVALID_INPUT', 'Feedback text is required');
    }
    const feedbackDir = await this.getFeedbackDir(projectId);
    await fs.mkdir(feedbackDir, { recursive: true });
    const id = uuid();

    // Create initial feedback item
    const item: FeedbackItem = {
      id,
      text,
      category: 'bug', // Default, will be updated by AI
      mappedPlanId: null,
      createdTaskIds: [],
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // Save immediately
    await this.writeJson(path.join(feedbackDir, `${id}.json`), item);

    // Invoke planning agent for categorization (async)
    this.categorizeFeedback(projectId, item).catch((err) => {
      console.error(`Failed to categorize feedback ${id}:`, err);
    });

    return item;
  }

  /** Build PRD context for AI (relevant sections as markdown) */
  private async getPrdContextForCategorization(projectId: string): Promise<string> {
    try {
      const prd = await this.prdService.getPrd(projectId);
      const sections = prd.sections;
      const parts: string[] = [];
      const keys = [
        'executive_summary',
        'feature_list',
        'technical_architecture',
        'data_model',
      ] as const;
      for (const key of keys) {
        const section = sections[key];
        if (section?.content?.trim()) {
          parts.push(`## ${key}\n${section.content.trim()}`);
        }
      }
      if (parts.length === 0) return 'No PRD content available.';
      return `# PRD (Product Requirements Document)\n\n${parts.join('\n\n')}`;
    } catch {
      return 'No PRD available.';
    }
  }

  /** Build plan context for AI mapping (planId, title from first heading) */
  private async getPlanContextForCategorization(projectId: string): Promise<string> {
    try {
      const plans = await this.planService.listPlans(projectId);
      if (plans.length === 0) return 'No plans exist yet. Use mappedPlanId: null.';
      const lines = plans.map((p) => {
        const title = p.content.split('\n')[0]?.replace(/^#+\s*/, '').trim() || p.metadata.planId;
        return `- ${p.metadata.planId}: ${title}`;
      });
      return `Available plans (use planId for mappedPlanId):\n${lines.join('\n')}`;
    } catch {
      return 'No plans available. Use mappedPlanId: null.';
    }
  }

  /** AI categorization and mapping (bead task creation is done in srl.4) */
  private async categorizeFeedback(projectId: string, item: FeedbackItem): Promise<void> {
    const settings = await this.projectService.getSettings(projectId);
    const project = await this.projectService.getProject(projectId);
    const [prdContext, planContext] = await Promise.all([
      this.getPrdContextForCategorization(projectId),
      this.getPlanContextForCategorization(projectId),
    ]);

    let plans: { metadata: { planId: string } }[] = [];
    try {
      plans = await this.planService.listPlans(projectId);
    } catch {
      // Ignore
    }
    const firstPlanId = plans.length > 0 ? plans[0].metadata.planId : null;

    try {
      const response = await this.agentClient.invoke({
        config: settings.planningAgent,
        prompt: `# PRD\n\n${prdContext}\n\n# Plans\n\n${planContext}\n\n# Feedback to categorize\n\n"${item.text}"`,
        systemPrompt: FEEDBACK_CATEGORIZATION_PROMPT,
        cwd: project.repoPath,
      });

      // Parse AI response; fallback: default to bug, map to first plan (PRD §7.4.2 edge case)
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const validCategories: FeedbackCategory[] = ['bug', 'feature', 'ux', 'scope'];
        item.category = validCategories.includes(parsed.category)
          ? (parsed.category as FeedbackCategory)
          : 'bug';
        item.mappedPlanId = parsed.mappedPlanId || firstPlanId;

        // task_titles: array of strings; support legacy suggestedTitle
        const taskTitles = Array.isArray(parsed.task_titles)
          ? parsed.task_titles.filter((t: unknown) => typeof t === 'string')
          : parsed.suggestedTitle
            ? [String(parsed.suggestedTitle)]
            : [item.text.slice(0, 80)];
        (item as FeedbackItem & { taskTitles?: string[] }).taskTitles = taskTitles;

        // Handle scope changes with HIL (PRD §7.4.2, §15.1)
        if (item.category === 'scope') {
          const { approved } = await this.hilService.evaluateDecision(
            projectId,
            'scopeChanges',
            `Scope change feedback: "${item.text}"`,
          );

          if (!approved) {
            item.status = 'mapped';
            broadcastToProject(projectId, {
              type: 'feedback.mapped',
              feedbackId: item.id,
              planId: item.mappedPlanId || '',
              taskIds: item.createdTaskIds,
            });
            await this.saveFeedback(projectId, item);
            return;
          }

          // After HIL approval, invoke the planning agent to update the PRD
          try {
            await this.chatService.syncPrdFromScopeChangeFeedback(projectId, item.text);
          } catch (err) {
            console.error('[feedback] PRD sync on scope-change approval failed:', err);
          }
        }

        item.status = 'mapped';

        // Broadcast feedback mapping
        broadcastToProject(projectId, {
          type: 'feedback.mapped',
          feedbackId: item.id,
          planId: item.mappedPlanId || '',
          taskIds: item.createdTaskIds,
        });
      } else {
        // Parse failed: default to bug, map to first plan
        item.category = 'bug';
        item.mappedPlanId = firstPlanId;
        (item as FeedbackItem & { taskTitles?: string[] }).taskTitles = [item.text.slice(0, 80)];
        item.status = 'mapped';
        broadcastToProject(projectId, {
          type: 'feedback.mapped',
          feedbackId: item.id,
          planId: item.mappedPlanId || '',
          taskIds: item.createdTaskIds,
        });
      }
    } catch (error) {
      console.error(`AI categorization failed for feedback ${item.id}:`, error);
      item.category = 'bug';
      item.mappedPlanId = firstPlanId;
      (item as FeedbackItem & { taskTitles?: string[] }).taskTitles = [item.text.slice(0, 80)];
      item.status = 'mapped';
      broadcastToProject(projectId, {
        type: 'feedback.mapped',
        feedbackId: item.id,
        planId: item.mappedPlanId || '',
        taskIds: item.createdTaskIds,
      });
    }

    await this.saveFeedback(projectId, item);
  }

  private async saveFeedback(projectId: string, item: FeedbackItem): Promise<void> {
    const feedbackDir = await this.getFeedbackDir(projectId);
    await this.writeJson(path.join(feedbackDir, `${item.id}.json`), item);
  }

  /** Get a single feedback item */
  async getFeedback(projectId: string, feedbackId: string): Promise<FeedbackItem> {
    const feedbackDir = await this.getFeedbackDir(projectId);
    try {
      const data = await fs.readFile(path.join(feedbackDir, `${feedbackId}.json`), 'utf-8');
      return JSON.parse(data) as FeedbackItem;
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr?.code === 'ENOENT') {
        throw new AppError(404, 'FEEDBACK_NOT_FOUND', `Feedback '${feedbackId}' not found`);
      }
      throw err;
    }
  }
}
