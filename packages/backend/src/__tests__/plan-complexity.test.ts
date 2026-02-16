import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { getPlanComplexityForTask } from "../services/plan-complexity.js";
import { BeadsService } from "../services/beads.service.js";

describe("getPlanComplexityForTask", () => {
  let tempDir: string;
  let beads: BeadsService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-complexity-"));
    beads = new BeadsService();

    // Initialize git and beads
    const { execSync } = await import("child_process");
    execSync("git init", { cwd: tempDir });
    execSync("git config user.email test@test.com", { cwd: tempDir });
    execSync("git config user.name Test", { cwd: tempDir });
    await beads.init(tempDir);

    // Create plans directory
    await fs.mkdir(path.join(tempDir, ".opensprint", "plans"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return the complexity from the parent epic's plan metadata", async () => {
    // Create an epic with a plan file reference
    const epic = await beads.create(tempDir, "Test Epic", {
      type: "epic",
      priority: 1,
      description: ".opensprint/plans/test-plan.md",
    });

    // Create the plan metadata file
    await fs.writeFile(
      path.join(tempDir, ".opensprint", "plans", "test-plan.meta.json"),
      JSON.stringify({
        planId: "test-plan",
        beadEpicId: epic.id,
        gateTaskId: `${epic.id}.0`,
        shippedAt: null,
        complexity: "high",
      }),
    );

    // Create a child task under the epic
    const child = await beads.create(tempDir, "Child Task", {
      type: "task",
      priority: 1,
      description: "Implement something",
      parentId: epic.id,
    });

    const task = await beads.show(tempDir, child.id);
    const complexity = await getPlanComplexityForTask(tempDir, task);
    expect(complexity).toBe("high");
  });

  it("should return undefined when task has no parent", async () => {
    const standalone = await beads.create(tempDir, "Standalone Task", {
      type: "task",
      priority: 1,
      description: "No parent",
    });

    const task = await beads.show(tempDir, standalone.id);
    const complexity = await getPlanComplexityForTask(tempDir, task);
    expect(complexity).toBeUndefined();
  });

  it("should return undefined when parent has no plan metadata", async () => {
    const epic = await beads.create(tempDir, "Epic Without Plan", {
      type: "epic",
      priority: 1,
      description: "Just a description, not a plan path",
    });

    const child = await beads.create(tempDir, "Child Task", {
      type: "task",
      priority: 1,
      description: "Task under no-plan epic",
      parentId: epic.id,
    });

    const task = await beads.show(tempDir, child.id);
    const complexity = await getPlanComplexityForTask(tempDir, task);
    expect(complexity).toBeUndefined();
  });

  it("should return undefined when metadata has invalid complexity", async () => {
    const epic = await beads.create(tempDir, "Bad Complexity Epic", {
      type: "epic",
      priority: 1,
      description: ".opensprint/plans/bad-plan.md",
    });

    await fs.writeFile(
      path.join(tempDir, ".opensprint", "plans", "bad-plan.meta.json"),
      JSON.stringify({
        planId: "bad-plan",
        beadEpicId: epic.id,
        gateTaskId: `${epic.id}.0`,
        shippedAt: null,
        complexity: "extreme",
      }),
    );

    const child = await beads.create(tempDir, "Child Task", {
      type: "task",
      priority: 1,
      description: "Task",
      parentId: epic.id,
    });

    const task = await beads.show(tempDir, child.id);
    const complexity = await getPlanComplexityForTask(tempDir, task);
    expect(complexity).toBeUndefined();
  });
});
