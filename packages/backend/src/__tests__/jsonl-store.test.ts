import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  createIssue,
  updateIssue,
  closeIssue,
  deleteIssue,
  addDependency,
  addLabel,
  removeLabel,
  invalidateStoreCache,
  clearStoreCache,
} from "../services/jsonl-store.js";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";

function ensureBeadsDir(repoPath: string): void {
  const dir = path.join(repoPath, ".beads");
  fs.mkdirSync(dir, { recursive: true });
}

describe("jsonl-store", () => {
  let repoPath: string;

  beforeEach(() => {
    clearStoreCache();
    repoPath = path.join(os.tmpdir(), `jsonl-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(repoPath, { recursive: true });
    ensureBeadsDir(repoPath);
    fs.writeFileSync(path.join(repoPath, ".beads/issues.jsonl"), "", "utf-8");
  });

  afterEach(() => {
    try {
      fs.rmSync(repoPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("createIssue", () => {
    it("should create a top-level issue and persist to JSONL", async () => {
      const issue = await createIssue(repoPath, "My Task", { type: "task", priority: 1 });
      expect(issue.id).toBeTruthy();
      expect(issue.title).toBe("My Task");
      expect(issue.status).toBe("open");
      expect(issue.priority).toBe(1);
      expect(issue.issue_type).toBe("task");

      const content = fs.readFileSync(path.join(repoPath, ".beads/issues.jsonl"), "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!).title).toBe("My Task");
    });

    it("should create a child issue with parent dependency", async () => {
      const parent = await createIssue(repoPath, "Parent", { type: "epic" });
      const child = await createIssue(repoPath, "Child", { parentId: parent.id });
      expect(child.id).toMatch(new RegExp(`^${parent.id}\\.\\d+$`));
      expect((child as { dependencies?: unknown[] }).dependencies).toHaveLength(1);
    });
  });

  describe("updateIssue", () => {
    it("should update status and assignee", async () => {
      const created = await createIssue(repoPath, "Task", {});
      const updated = await updateIssue(repoPath, created.id, {
        status: "in_progress",
        assignee: "alice",
      });
      expect(updated.status).toBe("in_progress");
      expect(updated.assignee).toBe("alice");
    });

    it("should throw AppError with ISSUE_NOT_FOUND when issue does not exist", async () => {
      await expect(updateIssue(repoPath, "nonexistent-id", { status: "closed" })).rejects.toThrow(AppError);
      await expect(updateIssue(repoPath, "nonexistent-id", { status: "closed" })).rejects.toMatchObject({
        statusCode: 404,
        code: ErrorCodes.ISSUE_NOT_FOUND,
        message: expect.stringContaining("nonexistent-id"),
      });
    });
  });

  describe("closeIssue", () => {
    it("should set status to closed and set close_reason", async () => {
      const created = await createIssue(repoPath, "Task", {});
      const closed = await closeIssue(repoPath, created.id, "Done");
      expect(closed.status).toBe("closed");
      expect((closed as Record<string, unknown>).close_reason).toBe("Done");
    });

    it("should throw AppError with ISSUE_NOT_FOUND when issue does not exist", async () => {
      await expect(closeIssue(repoPath, "nonexistent-id", "Done")).rejects.toThrow(AppError);
      await expect(closeIssue(repoPath, "nonexistent-id", "Done")).rejects.toMatchObject({
        statusCode: 404,
        code: ErrorCodes.ISSUE_NOT_FOUND,
      });
    });
  });

  describe("deleteIssue", () => {
    it("should remove issue from store", async () => {
      const created = await createIssue(repoPath, "Task", {});
      await deleteIssue(repoPath, created.id);
      const content = fs.readFileSync(path.join(repoPath, ".beads/issues.jsonl"), "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(0);
    });
  });

  describe("addDependency", () => {
    it("should add dependency to child issue", async () => {
      const parent = await createIssue(repoPath, "Parent", {});
      const child = await createIssue(repoPath, "Child", {});
      await addDependency(repoPath, child.id, parent.id, "blocks");
      const updated = await updateIssue(repoPath, child.id, {});
      const deps = (updated as { dependencies?: unknown[] }).dependencies ?? [];
      expect(deps.length).toBeGreaterThanOrEqual(1);
      const blocksDep = deps.find((d: { type?: string }) => d.type === "blocks");
      expect(blocksDep).toBeDefined();
    });

    it("should throw AppError with ISSUE_NOT_FOUND when child does not exist", async () => {
      const parent = await createIssue(repoPath, "Parent", {});
      await expect(addDependency(repoPath, "nonexistent-child", parent.id)).rejects.toThrow(AppError);
      await expect(addDependency(repoPath, "nonexistent-child", parent.id)).rejects.toMatchObject({
        statusCode: 404,
        code: ErrorCodes.ISSUE_NOT_FOUND,
      });
    });
  });

  describe("addLabel / removeLabel", () => {
    it("should add and remove labels", async () => {
      const created = await createIssue(repoPath, "Task", {});
      await addLabel(repoPath, created.id, "bug");
      let issue = await updateIssue(repoPath, created.id, {});
      expect(issue.labels).toContain("bug");

      await addLabel(repoPath, created.id, "urgent");
      issue = await updateIssue(repoPath, created.id, {});
      expect(issue.labels).toContain("urgent");

      await removeLabel(repoPath, created.id, "bug");
      issue = await updateIssue(repoPath, created.id, {});
      expect(issue.labels).not.toContain("bug");
      expect(issue.labels).toContain("urgent");
    });

    it("should throw AppError with ISSUE_NOT_FOUND when issue does not exist", async () => {
      await expect(addLabel(repoPath, "nonexistent-id", "bug")).rejects.toThrow(AppError);
      await expect(addLabel(repoPath, "nonexistent-id", "bug")).rejects.toMatchObject({
        code: ErrorCodes.ISSUE_NOT_FOUND,
      });
      await expect(removeLabel(repoPath, "nonexistent-id", "bug")).rejects.toThrow(AppError);
    });
  });

  describe("invalidateStoreCache", () => {
    it("should cause next operation to re-read from disk", async () => {
      const created = await createIssue(repoPath, "Task", {});
      invalidateStoreCache(repoPath);
      // Manually write a different state to disk (simulate external bd write)
      const filePath = path.join(repoPath, ".beads/issues.jsonl");
      const raw = JSON.stringify({
        ...created,
        title: "Updated externally",
        updated_at: new Date().toISOString(),
      });
      fs.writeFileSync(filePath, raw + "\n", "utf-8");
      invalidateStoreCache(repoPath);
      const updated = await updateIssue(repoPath, created.id, {});
      expect(updated.title).toBe("Updated externally");
    });
  });

  describe("ID generation", () => {
    it("should generate unique top-level IDs", async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const issue = await createIssue(repoPath, `Task ${i}`, {});
        ids.add(issue.id);
      }
      expect(ids.size).toBe(10);
    });

    it("should generate sequential child IDs under same parent", async () => {
      const parent = await createIssue(repoPath, "Parent", {});
      const c1 = await createIssue(repoPath, "C1", { parentId: parent.id });
      const c2 = await createIssue(repoPath, "C2", { parentId: parent.id });
      expect(c1.id).toBe(`${parent.id}.1`);
      expect(c2.id).toBe(`${parent.id}.2`);
    });
  });
});
