import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskDetailDiagnostics, formatAttemptTimestamp } from "./TaskDetailDiagnostics";

describe("formatAttemptTimestamp", () => {
  it("formats ISO timestamp as human-readable date/time", () => {
    const formatted = formatAttemptTimestamp("2025-03-10T14:32:00.000Z");
    expect(formatted).toMatch(/\d/);
    expect(formatted).toMatch(/2025/);
    expect(formatted).toMatch(/3|03|Mar/);
  });

  it("returns empty string for null", () => {
    expect(formatAttemptTimestamp(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatAttemptTimestamp(undefined)).toBe("");
  });

  it("returns empty string for invalid ISO string", () => {
    expect(formatAttemptTimestamp("not-a-date")).toBe("");
  });
});

describe("TaskDetailDiagnostics", () => {
  it("shows date/time in attempt history rows when timestamp is present", () => {
    render(
      <TaskDetailDiagnostics
        task={null}
        diagnostics={{
          taskId: "task-1",
          taskStatus: "blocked",
          cumulativeAttempts: 1,
          latestSummary: null,
          latestOutcome: "failed",
          timeline: [],
          attempts: [
            {
              attempt: 1,
              finalPhase: "coding",
              finalOutcome: "failed",
              finalSummary: "Attempt failed",
              sessionAttemptStatuses: [],
              completedAt: "2025-03-10T14:32:00.000Z",
            },
          ],
        }}
        diagnosticsLoading={false}
      />
    );
    expect(screen.getByTestId("execution-attempt-1")).toHaveTextContent(/2025/);
    expect(screen.getByTestId("execution-attempt-1")).toHaveTextContent("Coding · Failed");
  });

  it("shows in-progress message for running attempt in attempt history", () => {
    render(
      <TaskDetailDiagnostics
        task={null}
        diagnostics={{
          taskId: "task-1",
          taskStatus: "in_progress",
          cumulativeAttempts: 1,
          latestSummary: "Attempt 1 is in progress",
          latestOutcome: "running",
          timeline: [],
          attempts: [
            {
              attempt: 1,
              finalPhase: "orchestrator",
              finalOutcome: "running",
              finalSummary: "Attempt 1 is in progress",
              sessionAttemptStatuses: [],
            },
          ],
        }}
        diagnosticsLoading={false}
      />
    );
    expect(screen.getByTestId("execution-attempt-1")).toHaveTextContent("Attempt 1 is in progress");
    expect(screen.getByTestId("execution-attempt-1")).toHaveTextContent("Running");
  });

  it("renders attempt row without date when no timestamp", () => {
    render(
      <TaskDetailDiagnostics
        task={null}
        diagnostics={{
          taskId: "task-1",
          taskStatus: "blocked",
          cumulativeAttempts: 1,
          latestSummary: null,
          latestOutcome: "failed",
          timeline: [],
          attempts: [
            {
              attempt: 1,
              finalPhase: "coding",
              finalOutcome: "failed",
              finalSummary: "Attempt failed",
              sessionAttemptStatuses: [],
            },
          ],
        }}
        diagnosticsLoading={false}
      />
    );
    expect(screen.getByTestId("execution-attempt-1")).toHaveTextContent("Coding · Failed");
    expect(screen.getByTestId("execution-attempt-1")).toHaveTextContent("Attempt 1");
  });

  it("does not panel-wrap the section; each attempt row uses the shared card surface", () => {
    render(
      <TaskDetailDiagnostics
        task={null}
        diagnostics={{
          taskId: "task-1",
          taskStatus: "blocked",
          cumulativeAttempts: 1,
          latestSummary: null,
          latestOutcome: "failed",
          timeline: [],
          attempts: [
            {
              attempt: 1,
              finalPhase: "coding",
              finalOutcome: "failed",
              finalSummary: "Attempt failed",
              sessionAttemptStatuses: [],
            },
          ],
        }}
        diagnosticsLoading={false}
      />
    );
    const section = screen.getByTestId("execution-diagnostics-section");
    // Section root has no panel styling (border/bg removed in de75.39)
    expect(section.className).not.toMatch(/\bbg-theme-surface\b/);
    // Attempt rows live directly inside the section
    const attemptRow = screen.getByTestId("execution-attempt-1");
    expect(section).toContainElement(attemptRow);
  });

  it("prioritizes failed command + first error and reveals structured details on demand", async () => {
    const user = userEvent.setup();
    render(
      <TaskDetailDiagnostics
        task={null}
        diagnostics={{
          taskId: "task-1",
          taskStatus: "blocked",
          cumulativeAttempts: 2,
          latestSummary: "Quality gate failed during tests",
          latestOutcome: "blocked",
          latestNextAction: "Run npm ci in the repository root, then retry the quality gate.",
          latestQualityGateDetail: {
            command: "npm run test -w packages/backend",
            reason: "Command failed with exit code 1",
            outputSnippet: "Error: Cannot find module 'typescript'\nRequire stack:\n- /tmp/test.js",
            worktreePath: "/tmp/opensprint/os-d350.8",
            firstErrorLine: "Error: Cannot find module 'typescript'",
          },
          timeline: [],
          attempts: [
            {
              attempt: 2,
              finalPhase: "merge",
              finalOutcome: "blocked",
              finalSummary: "Quality gate failed during tests",
              sessionAttemptStatuses: [],
            },
          ],
        }}
        diagnosticsLoading={false}
      />
    );

    expect(screen.getByTestId("execution-diagnostics-primary-message")).toHaveTextContent(
      "npm run test -w packages/backend | Error: Cannot find module 'typescript'"
    );

    expect(screen.queryByTestId("execution-diagnostics-details")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("execution-diagnostics-details-toggle"));

    expect(screen.getByTestId("execution-diagnostics-details-output-snippet")).toHaveTextContent(
      "Error: Cannot find module 'typescript'"
    );
    expect(screen.getByTestId("execution-diagnostics-details-worktree")).toHaveTextContent(
      "/tmp/opensprint/os-d350.8"
    );
    expect(screen.getByTestId("execution-diagnostics-details-remediation")).toHaveTextContent(
      "Run npm ci in the repository root, then retry the quality gate."
    );
  });

  it("derives primary message from output snippet when firstErrorLine is omitted", () => {
    render(
      <TaskDetailDiagnostics
        task={null}
        diagnostics={{
          taskId: "task-2",
          taskStatus: "requeued",
          cumulativeAttempts: 4,
          latestSummary: "Quality gate failed",
          latestOutcome: "requeued",
          latestNextAction: "Run npm ci and retry.",
          latestQualityGateDetail: {
            command: "npm run build",
            reason: "Command failed with exit code 1",
            outputSnippet: "\nCannot find module 'typescript'\nRequire stack:\n- /tmp/build.js",
            worktreePath: "/tmp/opensprint/os-d350.9",
          },
          timeline: [],
          attempts: [
            {
              attempt: 4,
              finalPhase: "merge",
              finalOutcome: "requeued",
              finalSummary: "Quality gate failed",
              sessionAttemptStatuses: [],
            },
          ],
        }}
        diagnosticsLoading={false}
      />
    );

    expect(screen.getByTestId("execution-diagnostics-primary-message")).toHaveTextContent(
      "npm run build | Cannot find module 'typescript'"
    );
  });

  it("derives primary message from reason when snippet and firstErrorLine are missing", async () => {
    const user = userEvent.setup();
    render(
      <TaskDetailDiagnostics
        task={null}
        diagnostics={{
          taskId: "task-3",
          taskStatus: "requeued",
          cumulativeAttempts: 5,
          latestSummary: "Quality gate failed",
          latestOutcome: "requeued",
          latestNextAction: "Run npm ci and retry.",
          latestQualityGateDetail: {
            command: "npm run build",
            reason: "Command failed with exit code 1",
            worktreePath: "/tmp/opensprint/os-d350.9",
          },
          timeline: [],
          attempts: [
            {
              attempt: 5,
              finalPhase: "merge",
              finalOutcome: "requeued",
              finalSummary: "Quality gate failed",
              sessionAttemptStatuses: [],
            },
          ],
        }}
        diagnosticsLoading={false}
      />
    );

    expect(screen.getByTestId("execution-diagnostics-primary-message")).toHaveTextContent(
      "npm run build | Command failed with exit code 1"
    );
    await user.click(screen.getByTestId("execution-diagnostics-details-toggle"));
    expect(screen.getByTestId("execution-diagnostics-details-reason")).toHaveTextContent(
      "Command failed with exit code 1"
    );
  });

  it("shows human environment headline before technical command line and labels merged_candidate paths", async () => {
    const user = userEvent.setup();
    const validationPath =
      "/var/folders/xx/opensprint-validation/merged_candidate-abc123/wt";
    render(
      <TaskDetailDiagnostics
        task={null}
        diagnostics={{
          taskId: "task-env",
          taskStatus: "blocked",
          cumulativeAttempts: 1,
          latestSummary: "Merge check environment: …",
          latestOutcome: "blocked",
          latestNextAction: "Retry merge",
          latestQualityGateDetail: {
            category: "environment_setup",
            validationWorkspace: "merged_candidate",
            command: "npm run test",
            reason: `Validation workspace node_modules is missing or empty at ${validationPath}/node_modules`,
            worktreePath: validationPath,
            firstErrorLine: `Validation workspace node_modules is missing or empty at ${validationPath}/node_modules`,
            userTitle: "Dependencies missing in merge check",
            userSummary:
              "Dependencies were not installed in the temporary merge preview folder Open Sprint uses to validate merges.",
          },
          timeline: [],
          attempts: [
            {
              attempt: 1,
              finalPhase: "merge",
              finalOutcome: "blocked",
              finalSummary: "Quality gate environment failure",
              sessionAttemptStatuses: [],
            },
          ],
        }}
        diagnosticsLoading={false}
      />
    );

    expect(screen.getByTestId("execution-diagnostics-primary-message")).toHaveTextContent(
      "Dependencies missing in merge check"
    );
    expect(screen.getByTestId("execution-diagnostics-primary-message")).toHaveTextContent(
      "temporary merge preview"
    );
    expect(screen.getByTestId("execution-diagnostics-primary-message")).not.toHaveTextContent(
      "npm run test"
    );

    await user.click(screen.getByTestId("execution-diagnostics-details-toggle"));
    expect(screen.getByTestId("execution-diagnostics-details-reason")).toHaveTextContent(
      validationPath
    );
    expect(screen.getByTestId("execution-diagnostics-details-worktree")).toHaveTextContent(
      "Internal validation folder (not your project path):"
    );
    expect(screen.getByTestId("execution-diagnostics-details-worktree")).toHaveTextContent(
      validationPath
    );
    const describedBy = screen
      .getByTestId("execution-diagnostics-details-worktree")
      .getAttribute("aria-describedby");
    expect(describedBy).toContain("execution-diagnostics-detail-human-preface");
    expect(describedBy).toContain("execution-diagnostics-human-headline");
  });

  it("keeps legacy summary rendering when structured detail payload is missing", () => {
    render(
      <TaskDetailDiagnostics
        task={null}
        diagnostics={{
          taskId: "task-1",
          taskStatus: "requeued",
          cumulativeAttempts: 3,
          latestSummary: "Attempt 3 failed before coding started because dependencies were invalid",
          latestOutcome: "requeued",
          latestNextAction: "Run npm ci in the repository root",
          timeline: [],
          attempts: [
            {
              attempt: 3,
              finalPhase: "orchestrator",
              finalOutcome: "requeued",
              finalSummary:
                "Attempt 3 failed before coding started because dependencies were invalid",
              sessionAttemptStatuses: [],
            },
          ],
        }}
        diagnosticsLoading={false}
      />
    );

    expect(screen.getByTestId("execution-diagnostics-latest-summary")).toHaveTextContent(
      "dependencies were invalid"
    );
    expect(screen.queryByTestId("execution-diagnostics-primary-message")).not.toBeInTheDocument();
    expect(screen.queryByTestId("execution-diagnostics-details-toggle")).not.toBeInTheDocument();
  });
});
