import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
