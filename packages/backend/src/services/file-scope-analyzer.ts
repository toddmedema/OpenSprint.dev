import path from "path";
import type { BeadsService, BeadsIssue } from "./beads.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("file-scope-analyzer");

export interface FileScope {
  taskId: string;
  files: Set<string>;
  directories: Set<string>;
  confidence: "explicit" | "inferred" | "heuristic";
}

/**
 * Predicts and records the file scope of tasks for conflict-aware scheduling.
 * Uses a layered approach:
 * 1. Explicit: `files:` label from Planner output
 * 2. Inferred: `actual_files:` labels from completed dependency tasks
 * 3. Heuristic: directory guesses from task title/description
 */
export class FileScopeAnalyzer {
  /**
   * Predict file scope for a task using available metadata.
   * Returns a FileScope with confidence level indicating the source.
   * When idToIssue is provided (e.g. from listAll), avoids extra beads show() calls for blockers.
   */
  async predict(
    repoPath: string,
    task: BeadsIssue,
    beads: BeadsService,
    options?: { idToIssue?: Map<string, BeadsIssue> }
  ): Promise<FileScope> {
    const scope: FileScope = {
      taskId: task.id,
      files: new Set(),
      directories: new Set(),
      confidence: "heuristic",
    };

    // Layer 1: Explicit file scope from Planner annotations
    const filesLabel = this.getFileScopeLabel(task);
    if (filesLabel) {
      try {
        const parsed = JSON.parse(filesLabel) as { modify?: string[]; create?: string[] };
        const allFiles = [...(parsed.modify ?? []), ...(parsed.create ?? [])];
        for (const f of allFiles) {
          scope.files.add(f);
          scope.directories.add(path.dirname(f));
        }
        if (scope.files.size > 0) {
          scope.confidence = "explicit";
          return scope;
        }
      } catch {
        log.warn("Failed to parse files label", { taskId: task.id });
      }
    }

    // Layer 2: Inferred from dependency tasks' actual files
    const depFiles = await this.inferFromDependencies(
      repoPath,
      task,
      beads,
      options?.idToIssue
    );
    if (depFiles.size > 0) {
      scope.files = depFiles;
      for (const f of depFiles) {
        scope.directories.add(path.dirname(f));
      }
      scope.confidence = "inferred";
      return scope;
    }

    // Layer 3: Heuristic from task title/description
    const heuristicDirs = this.extractDirectoriesFromText(
      `${task.title ?? ""} ${task.description ?? ""}`
    );
    scope.directories = heuristicDirs;
    scope.confidence = "heuristic";
    return scope;
  }

  /**
   * Record actual files changed by a task after completion.
   * Stores as `actual_files:<json>` label for future inference.
   */
  async recordActual(repoPath: string, taskId: string, changedFiles: string[], beads: BeadsService): Promise<void> {
    if (changedFiles.length === 0) return;
    const label = `actual_files:${JSON.stringify(changedFiles)}`;
    try {
      await beads.addLabel(repoPath, taskId, label);
    } catch (err) {
      log.warn("Failed to record actual files", { taskId, err });
    }
  }

  /**
   * Check whether two file scopes overlap.
   * For explicit/inferred scopes: file-set intersection.
   * For heuristic scopes: directory containment.
   */
  overlaps(a: FileScope, b: FileScope): boolean {
    // File-level overlap
    for (const f of a.files) {
      if (b.files.has(f)) return true;
    }

    // Directory-level overlap (at least one scope is heuristic)
    if (a.confidence === "heuristic" || b.confidence === "heuristic") {
      for (const dirA of a.directories) {
        for (const dirB of b.directories) {
          if (dirA === dirB || dirA.startsWith(dirB + "/") || dirB.startsWith(dirA + "/")) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /** Extract `files:` label value from a bead issue */
  private getFileScopeLabel(task: BeadsIssue): string | null {
    const labels = (task.labels ?? []) as string[];
    const prefix = "files:";
    const label = labels.find((l) => l.startsWith(prefix));
    return label ? label.slice(prefix.length) : null;
  }

  /** Look at completed dependency tasks for actual_files labels. When idToIssue is provided, avoids beads show() calls. */
  private async inferFromDependencies(
    repoPath: string,
    task: BeadsIssue,
    beads: BeadsService,
    idToIssue?: Map<string, BeadsIssue>
  ): Promise<Set<string>> {
    const files = new Set<string>();

    try {
      const blockers = idToIssue
        ? beads.getBlockersFromIssue(task)
        : await beads.getBlockers(repoPath, task.id);
      for (const blockerId of blockers) {
        try {
          const blocker = idToIssue?.get(blockerId) ?? (await beads.show(repoPath, blockerId));
          const actualLabel = ((blocker.labels ?? []) as string[]).find((l: string) =>
            l.startsWith("actual_files:")
          );
          if (actualLabel) {
            const parsed = JSON.parse(actualLabel.slice("actual_files:".length)) as string[];
            for (const f of parsed) files.add(f);
          }
        } catch {
          // Blocker might not exist or have invalid labels
        }
      }
    } catch {
      // No blockers or getBlockers not available
    }

    return files;
  }

  /**
   * Extract likely directory paths from text using common patterns.
   * Looks for paths like "src/components", "packages/backend/src", etc.
   */
  private extractDirectoriesFromText(text: string): Set<string> {
    const dirs = new Set<string>();
    const pathPattern = /(?:^|\s)((?:src|lib|packages|app|components|services|utils|pages|routes|api|test|__tests__)(?:\/[a-zA-Z0-9_.-]+)*)/g;
    let match;
    while ((match = pathPattern.exec(text)) !== null) {
      dirs.add(match[1]);
    }
    return dirs;
  }
}
