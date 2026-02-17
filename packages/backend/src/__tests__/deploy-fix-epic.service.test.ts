import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createFixEpicFromTestOutput } from "../services/deploy-fix-epic.service.js";
import { ProjectService } from "../services/project.service.js";
import { BeadsService } from "../services/beads.service.js";
import { DEFAULT_HIL_CONFIG } from "@opensprint/shared";

const mockInvoke = vi.fn().mockResolvedValue({
  content: JSON.stringify({
    status: "success",
    tasks: [
      { index: 0, title: "Fix auth test", description: "Fix failing auth test", priority: 1, depends_on: [] },
      { index: 1, title: "Fix API test", description: "Fix API endpoint test", priority: 1, depends_on: [0] },
    ],
  }),
});

vi.mock("../services/agent-client.js", () => ({
  AgentClient: vi.fn().mockImplementation(() => ({ invoke: mockInvoke })),
}));

describe("deploy-fix-epic service", () => {
  let tempDir: string;
  let projectId: string;
  let projectService: ProjectService;

  beforeEach(async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        status: "success",
        tasks: [
          { index: 0, title: "Fix auth test", description: "Fix failing auth test", priority: 1, depends_on: [] },
          { index: 1, title: "Fix API test", description: "Fix API endpoint test", priority: 1, depends_on: [0] },
        ],
      }),
    });
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "deploy-fix-epic-test-"));
    projectService = new ProjectService();

    const repoPath = path.join(tempDir, "proj");
    await fs.mkdir(repoPath, { recursive: true });
    await fs.writeFile(
      path.join(repoPath, "package.json"),
      JSON.stringify({ name: "test", scripts: { test: "echo ok" } }),
    );

    const project = await projectService.createProject({
      name: "Fix Epic Test",
      description: "Test",
      repoPath,
      planningAgent: { type: "custom", model: null, cliCommand: "echo" },
      codingAgent: { type: "custom", model: null, cliCommand: "echo" },
      deployment: { mode: "custom" },
      hilConfig: DEFAULT_HIL_CONFIG,
    });
    projectId = project.id;
  });

  it("returns null when agent returns failed status", async () => {
    mockInvoke.mockResolvedValueOnce({
      content: JSON.stringify({ status: "failed", tasks: [] }),
    });

    const project = await projectService.getProject(projectId);
    const result = await createFixEpicFromTestOutput(
      projectId,
      project.repoPath,
      "FAIL  src/auth.test.ts",
    );

    expect(result).toBeNull();
  });

  it("creates fix epic and tasks when agent returns valid tasks", async () => {
    const project = await projectService.getProject(projectId);
    const result = await createFixEpicFromTestOutput(
      projectId,
      project.repoPath,
      "FAIL  src/auth.test.ts\n  Expected: true\n  Received: false",
    );

    expect(result).not.toBeNull();
    expect(result!.epicId).toBeDefined();
    expect(result!.taskCount).toBe(2);
    expect(result!.gateTaskId).toBeDefined();

    const beads = new BeadsService();
    const ready = await beads.ready(project.repoPath);
    expect(ready.length).toBeGreaterThan(0);
  });
});
