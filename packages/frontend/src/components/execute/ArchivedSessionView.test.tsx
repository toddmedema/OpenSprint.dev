import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArchivedSessionView } from "./ArchivedSessionView";

/** Wrapper with fixed height so virtualizer has a scroll container (jsdom has no layout) */
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <div style={{ height: 600 }}>{children}</div>;
}

describe("ArchivedSessionView", () => {
  it("renders single session with attempt, status, and agent type", () => {
    const sessions = [
      {
        attempt: 1,
        status: "approved",
        agentType: "coder",
        outputLog: "Build output",
        gitDiff: null,
        testResults: null,
        failureReason: null,
      },
    ];
    render(
      <TestWrapper>
        <ArchivedSessionView sessions={sessions} />
      </TestWrapper>
    );

    expect(screen.getByText(/Attempt 1/)).toBeInTheDocument();
    expect(screen.getByText(/approved/)).toBeInTheDocument();
    expect(screen.getByText(/coder/)).toBeInTheDocument();
    expect(screen.getByText("Build output")).toBeInTheDocument();
  });

  it("renders Output log and Git diff tabs when session has gitDiff", async () => {
    const user = userEvent.setup();
    const sessions = [
      {
        attempt: 1,
        status: "approved",
        agentType: "coder",
        outputLog: "Log content",
        gitDiff: "diff content",
        testResults: null,
        failureReason: null,
      },
    ];
    render(
      <TestWrapper>
        <ArchivedSessionView sessions={sessions} />
      </TestWrapper>
    );

    expect(screen.getByText("Output log")).toBeInTheDocument();
    expect(screen.getByText("Git diff")).toBeInTheDocument();
    expect(screen.getByText("Log content")).toBeInTheDocument();

    await user.click(screen.getByText("Git diff"));
    expect(screen.getByText("diff content")).toBeInTheDocument();
  });

  it("renders select for multiple sessions", () => {
    const sessions = [
      {
        attempt: 1,
        status: "failed",
        agentType: "coder",
        outputLog: "First attempt",
        gitDiff: null,
        testResults: null,
        failureReason: "Tests failed",
      },
      {
        attempt: 2,
        status: "approved",
        agentType: "coder",
        outputLog: "Second attempt",
        gitDiff: null,
        testResults: { passed: 5, failed: 0, skipped: 0, total: 5 },
        failureReason: null,
      },
    ];
    render(
      <TestWrapper>
        <ArchivedSessionView sessions={sessions} />
      </TestWrapper>
    );

    // Virtualized list: no combobox; scroll to last session by default
    expect(screen.getByTestId("archived-sessions-list")).toBeInTheDocument();
    expect(screen.getByText("Second attempt")).toBeInTheDocument();
    expect(screen.getByText("First attempt")).toBeInTheDocument(); // overscan may show both
  });

  it("shows test results when present", () => {
    const sessions = [
      {
        attempt: 1,
        status: "approved",
        agentType: "coder",
        outputLog: "Done",
        gitDiff: null,
        testResults: { passed: 4, failed: 1, skipped: 0, total: 5 },
        failureReason: null,
      },
    ];
    render(
      <TestWrapper>
        <ArchivedSessionView sessions={sessions} />
      </TestWrapper>
    );

    expect(screen.getByText(/4 passed/)).toBeInTheDocument();
    expect(screen.getByText(/, 1 failed/)).toBeInTheDocument();
  });

  it("shows failure reason when present", () => {
    const sessions = [
      {
        attempt: 1,
        status: "failed",
        agentType: "coder",
        outputLog: "Error",
        gitDiff: null,
        testResults: null,
        failureReason: "Build timeout",
      },
    ];
    render(
      <TestWrapper>
        <ArchivedSessionView sessions={sessions} />
      </TestWrapper>
    );

    expect(screen.getByText("Build timeout")).toBeInTheDocument();
  });

  it("returns null when sessions is empty", () => {
    const { container } = render(<ArchivedSessionView sessions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders output log as markdown with code blocks", () => {
    const sessions = [
      {
        attempt: 1,
        status: "approved",
        agentType: "coder",
        outputLog: "**Bold** and `code`\n\n```\nblock\n```",
        gitDiff: null,
        testResults: null,
        failureReason: null,
      },
    ];
    render(
      <TestWrapper>
        <ArchivedSessionView sessions={sessions} />
      </TestWrapper>
    );
    expect(screen.getByText("Bold")).toBeInTheDocument();
    expect(screen.getByText("code")).toBeInTheDocument();
    expect(screen.getByText("block")).toBeInTheDocument();
  });

  it("resets scroll position when scrollResetKey changes", () => {
    const sessions = [
      {
        attempt: 1,
        status: "approved",
        agentType: "coder",
        outputLog: "First session output",
        gitDiff: null,
        testResults: null,
        failureReason: null,
      },
    ];
    const { rerender } = render(
      <TestWrapper>
        <ArchivedSessionView sessions={sessions} scrollResetKey="task-1" />
      </TestWrapper>
    );

    const scrollContainer = screen.getByTestId("archived-sessions-list");
    expect(scrollContainer).toBeInTheDocument();

    // Simulate user scroll to some offset
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 150,
      writable: true,
      configurable: true,
    });

    // Switch task — scrollResetKey changes
    rerender(
      <TestWrapper>
        <ArchivedSessionView sessions={sessions} scrollResetKey="task-2" />
      </TestWrapper>
    );

    // For single session, scrollTop should reset to 0
    expect(scrollContainer.scrollTop).toBe(0);
  });

  it("filters NDJSON outputLog to show extracted text only", () => {
    const sessions = [
      {
        attempt: 1,
        status: "approved",
        agentType: "coder",
        outputLog:
          '{"type":"text","text":"Visible"}\n{"type":"tool_use","name":"edit"}\n{"type":"text","text":" content"}\n',
        gitDiff: null,
        testResults: null,
        failureReason: null,
      },
    ];
    render(
      <TestWrapper>
        <ArchivedSessionView sessions={sessions} />
      </TestWrapper>
    );
    expect(screen.getByText("Visible content")).toBeInTheDocument();
    expect(screen.queryByText(/tool_use/)).not.toBeInTheDocument();
  });
});
