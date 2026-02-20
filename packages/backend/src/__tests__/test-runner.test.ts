import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { TestRunner } from "../services/test-runner.js";

const mockSpawn = vi.fn();
const mockRegisterAgentProcess = vi.fn();
const mockUnregisterAgentProcess = vi.fn();

vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("../services/agent-process-registry.js", () => ({
  registerAgentProcess: (...args: unknown[]) => mockRegisterAgentProcess(...args),
  unregisterAgentProcess: (...args: unknown[]) => mockUnregisterAgentProcess(...args),
}));

function createMockChild(stdout: string, stderr: string, exitCode: number) {
  const listeners: { event: string; cb: (arg?: unknown) => void }[] = [];
  const stdoutListeners: ((data: Buffer) => void)[] = [];
  const stderrListeners: ((data: Buffer) => void)[] = [];

  const child = {
    pid: 12345,
    stdout: {
      on: (event: string, cb: (data: Buffer) => void) => {
        if (event === "data") stdoutListeners.push(cb);
      },
    },
    stderr: {
      on: (event: string, cb: (data: Buffer) => void) => {
        if (event === "data") stderrListeners.push(cb);
      },
    },
    on: (event: string, cb: (arg?: unknown) => void) => {
      listeners.push({ event, cb });
    },
    unref: () => {},
  };

  // Emit data and close asynchronously
  setImmediate(() => {
    if (stdout) stdoutListeners.forEach((cb) => cb(Buffer.from(stdout)));
    if (stderr) stderrListeners.forEach((cb) => cb(Buffer.from(stderr)));
    listeners.filter((l) => l.event === "close").forEach((l) => l.cb(exitCode));
  });

  return child;
}

describe("TestRunner", () => {
  let runner: TestRunner;

  beforeEach(() => {
    runner = new TestRunner();
    mockSpawn.mockClear();
    mockRegisterAgentProcess.mockClear();
    mockUnregisterAgentProcess.mockClear();
  });

  describe("runTestsWithOutput", () => {
    it("parses Vitest-style output and returns structured results on success", async () => {
      const output =
        "Tests: 5 passed, 0 failed, 2 skipped, 7 total\n✓ test one (10 ms)\n✓ test two (5 ms)";
      mockSpawn.mockReturnValue(createMockChild(output, "", 0));

      const result = await runner.runTestsWithOutput("/tmp/repo", "npm test");

      expect(result.passed).toBe(5);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(2);
      expect(result.total).toBe(7);
      expect(result.rawOutput).toContain(output);
      expect(mockSpawn).toHaveBeenCalledWith("sh", ["-c", "npm test"], expect.any(Object));
    });

    it("parses Jest-style summary and handles failed tests", async () => {
      const output = "Tests: 3 passed, 2 failed, 1 skipped, 6 total";
      mockSpawn.mockReturnValue(createMockChild(output, "Some error", 1));

      const result = await runner.runTestsWithOutput("/tmp/repo", "npx jest");

      expect(result.passed).toBe(3);
      expect(result.failed).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.total).toBe(6);
      expect(result.rawOutput).toContain(output);
    });

    it("returns fallback failure when exit code non-zero and no parseable output", async () => {
      mockSpawn.mockReturnValue(createMockChild("", "Command not found", 127));

      const result = await runner.runTestsWithOutput("/tmp/repo", "nonexistent-command");

      expect(result.passed).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.total).toBe(1);
      expect(result.details[0]?.status).toBe("failed");
      expect(result.details[0]?.error).toContain("Command not found");
    });

    it("returns empty results when no test command is provided and no package.json", async () => {
      mockSpawn.mockClear();
      const emptyDir = path.join(os.tmpdir(), `opensprint-test-runner-${Date.now()}`);
      await fs.mkdir(emptyDir, { recursive: true });
      try {
        const result = await runner.runTestsWithOutput(emptyDir);

        expect(result.passed).toBe(0);
        expect(result.failed).toBe(0);
        expect(result.total).toBe(0);
        expect(result.rawOutput).toBe("");
        expect(mockSpawn).not.toHaveBeenCalled();
      } finally {
        await fs.rm(emptyDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it("parses pytest-style output", async () => {
      const output = "3 passed, 1 failed, 0 skipped";
      mockSpawn.mockReturnValue(createMockChild(output, "", 1));

      const result = await runner.runTestsWithOutput("/tmp/repo", "pytest");

      expect(result.passed).toBe(3);
      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(0);
    });
  });

  describe("runScopedTests", () => {
    it("scopes vitest to changed test files when test command includes vitest", async () => {
      const output = "Tests: 2 passed, 0 failed, 0 skipped, 2 total";
      mockSpawn.mockReturnValue(createMockChild(output, "", 0));

      const result = await runner.runScopedTests(
        "/tmp/repo",
        ["src/foo.test.ts", "src/bar.ts"],
        "npx vitest run"
      );

      expect(mockSpawn).toHaveBeenCalledWith(
        "sh",
        ["-c", "npx vitest run src/foo.test.ts"],
        expect.any(Object)
      );
      expect(result.passed).toBe(2);
    });

    it("scopes jest to changed test files when test command includes jest", async () => {
      const output = "Tests: 1 passed, 0 failed, 0 skipped, 1 total";
      mockSpawn.mockReturnValue(createMockChild(output, "", 0));

      await runner.runScopedTests("/tmp/repo", ["src/a.test.ts", "src/b.spec.js"], "npx jest");

      expect(mockSpawn).toHaveBeenCalledWith(
        "sh",
        ["-c", "npx jest src/a.test.ts src/b.spec.js"],
        expect.any(Object)
      );
    });

    it("uses full test command when no test files in changed files", async () => {
      const output = "Tests: 5 passed, 0 failed, 0 skipped, 5 total";
      mockSpawn.mockReturnValue(createMockChild(output, "", 0));

      await runner.runScopedTests("/tmp/repo", ["src/foo.ts", "src/bar.ts"], "npm test");

      expect(mockSpawn).toHaveBeenCalledWith("sh", ["-c", "npm test"], expect.any(Object));
    });
  });

  describe("runTests", () => {
    it("returns TestResults without rawOutput", async () => {
      const output = "Tests: 1 passed, 0 failed, 0 skipped, 1 total";
      mockSpawn.mockReturnValue(createMockChild(output, "", 0));

      const result = await runner.runTests("/tmp/repo", "npm test");

      expect(result.passed).toBe(1);
      expect(result).not.toHaveProperty("rawOutput");
    });
  });
});
