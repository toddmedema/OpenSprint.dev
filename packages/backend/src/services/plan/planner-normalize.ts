/**
 * Planner output normalization: accept camelCase and snake_case from Planner/API.
 * Pure helpers for parsing and normalizing plan/task JSON.
 */
import { clampTaskComplexity } from "@opensprint/shared";

/** Derive epic title from plan content (first # heading) or format planId as title. */
export function getEpicTitleFromPlanContent(content: string, planId: string): string {
  const firstLine = (content ?? "").trim().split("\n")[0] ?? "";
  const match = firstLine.match(/^#\s+(.*)$/);
  const fromHeading = match?.[1]?.trim();
  if (fromHeading) return fromHeading;
  return planId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Normalize Planner task output: accept both camelCase (dependsOn) and snake_case (depends_on).
 * When tasksArray is provided, numeric indices in depends_on are resolved to task titles.
 */
export function normalizePlannerTaskDeps(
  task: Record<string, unknown>,
  tasksArray?: Array<{ title?: string; [k: string]: unknown }>
): string[] {
  const arr = (task.dependsOn ?? task.depends_on ?? []) as unknown;
  if (!Array.isArray(arr)) return [];
  const result: string[] = [];
  for (const x of arr) {
    if (typeof x === "string") {
      result.push(x);
    } else if (typeof x === "number" && tasksArray && x >= 0 && x < tasksArray.length) {
      const ref = tasksArray[x];
      const t = (ref?.title ?? (ref as Record<string, unknown>)?.task_title) as string | undefined;
      if (t) result.push(t);
    }
  }
  return result;
}

/** Normalized task shape for Planner output (accepts camelCase and snake_case field names). */
export interface NormalizedPlannerTask {
  title: string;
  description: string;
  priority: number;
  dependsOn: string[];
  complexity?: number;
  files?: { modify?: string[]; create?: string[]; test?: string[] };
}

/** First found tasks array in planner JSON, with source path for diagnostics. */
export interface ExtractedPlannerTaskArray {
  key: "tasks" | "task_list" | "taskList";
  path: string;
  value: unknown[];
}

/**
 * Find a planner tasks array recursively.
 * Accepts nested shapes like { result: { tasks: [...] } } in addition to top-level arrays.
 */
export function findPlannerTaskArray(value: unknown, path = "$"): ExtractedPlannerTaskArray | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findPlannerTaskArray(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  if (Array.isArray(record.tasks)) {
    return { key: "tasks", path: `${path}.tasks`, value: record.tasks };
  }
  if (Array.isArray(record.task_list)) {
    return { key: "task_list", path: `${path}.task_list`, value: record.task_list };
  }
  if (Array.isArray(record.taskList)) {
    return { key: "taskList", path: `${path}.taskList`, value: record.taskList };
  }

  for (const [key, child] of Object.entries(record)) {
    const found = findPlannerTaskArray(child, `${path}.${key}`);
    if (found) return found;
  }

  return null;
}

/**
 * Normalize a single Planner task: accept title/task_title, description/task_description,
 * priority, and dependsOn/depends_on (strings or indices when tasksArray provided).
 */
export function normalizePlannerTask(
  task: Record<string, unknown>,
  tasksArray?: Array<Record<string, unknown>>
): NormalizedPlannerTask {
  const title = (task.title as string) ?? (task.task_title as string) ?? "Untitled task";
  const description = (task.description as string) ?? (task.task_description as string) ?? "";
  const rawPriority = task.priority ?? task.task_priority;
  const priority =
    typeof rawPriority === "number" && rawPriority >= 0 && rawPriority <= 4 ? rawPriority : 2;
  const dependsOn = normalizePlannerTaskDeps(
    task,
    tasksArray as Array<{ title?: string; [k: string]: unknown }> | undefined
  );
  const raw = task.complexity;
  const complexity = clampTaskComplexity(raw);
  const rawFiles = task.files;
  const files =
    rawFiles && typeof rawFiles === "object"
      ? {
          modify: Array.isArray((rawFiles as { modify?: unknown }).modify)
            ? (rawFiles as { modify: unknown[] }).modify.filter(
                (f): f is string => typeof f === "string"
              )
            : undefined,
          create: Array.isArray((rawFiles as { create?: unknown }).create)
            ? (rawFiles as { create: unknown[] }).create.filter(
                (f): f is string => typeof f === "string"
              )
            : undefined,
          test: Array.isArray((rawFiles as { test?: unknown }).test)
            ? (rawFiles as { test: unknown[] }).test.filter(
                (f): f is string => typeof f === "string"
              )
            : undefined,
        }
      : undefined;
  return { title, description, priority, dependsOn, complexity, files };
}

/** Normalize plan-level dependsOnPlans: accept both camelCase and snake_case. */
export function normalizeDependsOnPlans(spec: Record<string, unknown>): string[] {
  const arr = (spec.dependsOnPlans ?? spec.depends_on_plans ?? []) as unknown;
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
}

export function normalizePlannerOpenQuestions(
  raw: Record<string, unknown>
): Array<{ id: string; text: string }> {
  const input = (raw.open_questions ?? raw.openQuestions ?? []) as unknown;
  if (!Array.isArray(input)) return [];

  return input
    .filter(
      (item): item is { id?: string; text: string } =>
        item != null && typeof item === "object" && typeof item.text === "string"
    )
    .map((item) => ({
      id: item.id?.trim() ? item.id.trim() : `q-${Math.random().toString(36).slice(2, 10)}`,
      text: item.text.trim(),
    }))
    .filter((item) => item.text.length > 0);
}

/**
 * Normalize plan-level fields from Planner output: accept both camelCase and snake_case.
 * Planner may return title/plan_title, content/plan_content/body, mockups/mock_ups, tasks/task_list.
 */
export function normalizePlanSpec(spec: Record<string, unknown>): {
  title: string;
  content: string;
  complexity?: string;
  mockups: Array<{ title: string; content: string }>;
  tasks: Array<Record<string, unknown>>;
} {
  const title = (spec.title as string) ?? (spec.plan_title as string) ?? "Untitled Feature";
  const content =
    (spec.content as string) ??
    (spec.plan_content as string) ??
    (spec.body as string) ??
    `# ${title}\n\nNo content.`;
  const rawMockups = (spec.mockups ?? spec.mock_ups ?? []) as unknown;
  const mockups = Array.isArray(rawMockups)
    ? rawMockups
        .filter((m): m is Record<string, unknown> => m != null && typeof m === "object")
        .map((m) => ({
          title: (m.title ?? m.label ?? "Mockup") as string,
          content: (m.content ?? m.body ?? "") as string,
        }))
        .filter((m) => m.title && m.content)
    : [];
  const rawTasksInput = (spec.tasks ?? spec.task_list ?? []) as unknown;
  const tasks = Array.isArray(rawTasksInput)
    ? rawTasksInput.filter((t): t is Record<string, unknown> => t != null && typeof t === "object")
    : [];
  return {
    title,
    content,
    complexity: spec.complexity as string | undefined,
    mockups,
    tasks,
  };
}

/**
 * Ensure plan content has a ## Dependencies section from dependsOnPlans (slugified plan IDs).
 */
export function ensureDependenciesSection(content: string, dependsOnPlans: string[]): string {
  if (!dependsOnPlans?.length) return content;
  const section = `## Dependencies\n\n${dependsOnPlans.map((s) => `- ${s}`).join("\n")}`;
  const re = /## Dependencies[\s\S]*?(?=##|$)/i;
  if (re.test(content)) {
    return content.replace(re, section);
  }
  return content.trimEnd() + "\n\n" + section;
}

/**
 * Extract a relative path to a .json file from agent response text.
 */
export function extractPlanJsonPathFromResponse(content: string): string | null {
  const backtickMatch = content.match(/`([^`]+\.json)`/);
  if (backtickMatch) return backtickMatch[1].trim();
  const phraseMatch = content.match(
    /(?:saved at|written to)\s+[`']?([a-zA-Z0-9_./-]+\.json)[`']?/i
  );
  if (phraseMatch) return phraseMatch[1].trim();
  return null;
}
