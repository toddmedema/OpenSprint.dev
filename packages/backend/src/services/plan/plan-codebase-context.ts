/**
 * Codebase context for plan flows: file tree, key files content, auto-review context, re-execute context.
 * All functions take repoPath and/or callbacks to avoid depending on PlanService (no circular deps).
 */
import fs from "fs/promises";
import path from "path";
import type { StoredTask } from "../task-store.service.js";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".opensprint",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
]);

const SKIP_DIRS_AUTO_REVIEW = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".venv",
]);

/** Build file tree string (excludes node_modules, .git, etc.) */
export async function buildFileTree(repoPath: string): Promise<string> {
  const lines: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of sorted) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(repoPath, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        lines.push(rel + "/");
        await walk(full);
      } else {
        lines.push(rel);
      }
    }
  };
  await walk(repoPath);
  return lines.join("\n") || "(empty)";
}

/** Get content of key source files (capped by size) */
export async function getKeyFilesContent(repoPath: string): Promise<string> {
  const EXT = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt"];
  const SKIP = ["node_modules", ".git", ".opensprint", "dist", "build", ".next"];
  const MAX_FILE = 50 * 1024;
  const MAX_TOTAL = 200 * 1024;
  let total = 0;
  const parts: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    if (total >= MAX_TOTAL) return;
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = full.replace(repoPath + path.sep, "").replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!SKIP.includes(entry.name)) await walk(full);
      } else if (EXT.some((e) => entry.name.endsWith(e))) {
        try {
          const content = await fs.readFile(full, "utf-8");
          const truncated =
            content.length > MAX_FILE ? content.slice(0, MAX_FILE) + "\n... (truncated)" : content;
          parts.push(`### ${rel}\n\n\`\`\`\n${truncated}\n\`\`\`\n`);
          total += truncated.length;
          if (total >= MAX_TOTAL) return;
        } catch {
          // skip unreadable
        }
      }
    }
  };
  await walk(repoPath);
  return parts.join("\n") || "(no source files)";
}

/** Get codebase context: file tree + key file contents. Used by getCodebaseContext and plan auto-review. */
export async function getCodebaseContextFromRepo(repoPath: string): Promise<{
  fileTree: string;
  keyFilesContent: string;
}> {
  const fileTree = await buildFileTree(repoPath);
  const keyFilesContent = await getKeyFilesContent(repoPath);
  return { fileTree, keyFilesContent };
}

/**
 * Build context string for the auto-review agent (file structure + key file excerpts).
 * Uses higher file count and size limits than getKeyFilesContent.
 */
export async function buildCodebaseContextForAutoReview(repoPath: string): Promise<string> {
  const MAX_FILES = 150;
  const MAX_FILE_SIZE = 2000;

  async function walk(dir: string, prefix: string, files: string[]): Promise<void> {
    if (files.length >= MAX_FILES) return;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (files.length >= MAX_FILES) break;
        const rel = prefix + e.name;
        if (e.isDirectory()) {
          if (!SKIP_DIRS_AUTO_REVIEW.has(e.name) && !e.name.startsWith(".")) {
            await walk(path.join(dir, e.name), rel + "/", files);
          }
        } else {
          files.push(rel);
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  const files: string[] = [];
  await walk(repoPath, "", files);
  let context =
    "## Repository file structure\n\n```\n" + files.slice(0, MAX_FILES).join("\n") + "\n```\n\n";

  const keyPatterns = ["package.json", "tsconfig.json", "src/", "app/", "lib/"];
  let keyFileCount = 0;
  for (const f of files) {
    if (context.length > 12000 || keyFileCount >= 8) break;
    if (
      keyPatterns.some((p) => f.includes(p)) &&
      (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".json"))
    ) {
      try {
        const fullPath = path.join(repoPath, f);
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_SIZE * 10) continue;
        const content = await fs.readFile(fullPath, "utf-8");
        const excerpt = content.slice(0, MAX_FILE_SIZE);
        context += `### ${f}\n\n\`\`\`\n${excerpt}${content.length > MAX_FILE_SIZE ? "\n... (truncated)" : ""}\n\`\`\`\n\n`;
        keyFileCount++;
      } catch {
        // Skip unreadable files
      }
    }
  }
  return context;
}

/** Lightweight check: repo has at least one source file. */
export async function hasExistingCode(repoPath: string): Promise<boolean> {
  const SOURCE_EXT = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt"];

  const walk = async (dir: string): Promise<boolean> => {
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (await walk(full)) return true;
      } else if (SOURCE_EXT.some((e) => entry.name.endsWith(e))) {
        return true;
      }
    }
    return false;
  };
  return walk(repoPath);
}

/** Get completed (closed) tasks for an epic for Auditor context. */
export function getCompletedTasksForEpic(
  allIssues: StoredTask[],
  epicId: string
): Array<{ id: string; title: string; description?: string; close_reason?: string }> {
  const closed = allIssues.filter(
    (i) =>
      i.id.startsWith(epicId + ".") &&
      (i.issue_type ?? i.type) !== "epic" &&
      (i.status as string) === "closed"
  );
  return closed.map((i) => ({
    id: i.id,
    title: i.title,
    description: i.description,
    close_reason: (i.close_reason as string) ?? (i as { close_reason?: string }).close_reason,
  }));
}

/**
 * Assemble context for Auditor: file tree, key files, completed tasks JSON.
 * listAll: (projectId: string) => Promise<StoredTask[]> (e.g. taskStore.listAll).
 */
export async function assembleReExecuteContext(
  repoPath: string,
  projectId: string,
  epicId: string,
  listAll: (projectId: string) => Promise<StoredTask[]>
): Promise<{ fileTree: string; keyFilesContent: string; completedTasksJson: string }> {
  const fileTree = await buildFileTree(repoPath);
  const keyFilesContent = await getKeyFilesContent(repoPath);
  const all = await listAll(projectId);
  const completedTasks = getCompletedTasksForEpic(all, epicId);
  const completedTasksJson = JSON.stringify(completedTasks, null, 2);
  return { fileTree, keyFilesContent, completedTasksJson };
}
