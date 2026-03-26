import { describe, it, expect } from "vitest";
import { runCommand } from "../utils/command-runner.js";

describe("command-runner maxStdoutBytes", () => {
  it("rejects when accumulated stdout exceeds the limit", async () => {
    await expect(
      runCommand(
        {
          command: "node",
          args: ["-e", "process.stdout.write('x'.repeat(50_000))"],
        },
        { cwd: process.cwd(), maxStdoutBytes: 100, timeout: 15_000 }
      )
    ).rejects.toMatchObject({
      name: "CommandRunError",
      message: expect.stringMatching(/output exceeded limit/i),
    });
  });

  it("completes when stdout stays under the limit", async () => {
    const result = await runCommand(
      {
        command: "node",
        args: ["-e", "process.stdout.write('ok')"],
      },
      { cwd: process.cwd(), maxStdoutBytes: 10_000, timeout: 15_000 }
    );
    expect(result.stdout).toBe("ok");
    expect(result.exitCode).toBe(0);
  });
});
