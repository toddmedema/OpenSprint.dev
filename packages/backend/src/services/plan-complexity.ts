import fs from "fs/promises";
import path from "path";
import type { PlanComplexity } from "@opensprint/shared";
import { BeadsService, type BeadsIssue } from "./beads.service.js";

const VALID_COMPLEXITIES: PlanComplexity[] = ["low", "medium", "high", "very_high"];

/**
 * Resolve the plan complexity for a task by looking up its parent epic's
 * plan metadata (.meta.json). Returns undefined if no complexity is found.
 */
export async function getPlanComplexityForTask(
  repoPath: string,
  task: BeadsIssue,
): Promise<PlanComplexity | undefined> {
  const beads = new BeadsService();
  const parentId = beads.getParentId(task.id);
  if (!parentId) return undefined;

  try {
    const parent = await beads.show(repoPath, parentId);
    const desc = parent.description as string;
    if (!desc?.startsWith(".opensprint/plans/")) return undefined;

    const planId = path.basename(desc, ".md");
    const metaPath = path.join(repoPath, ".opensprint", "plans", `${planId}.meta.json`);
    const raw = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw);

    if (meta.complexity && VALID_COMPLEXITIES.includes(meta.complexity)) {
      return meta.complexity as PlanComplexity;
    }
  } catch {
    // Parent or metadata might not exist
  }

  return undefined;
}
