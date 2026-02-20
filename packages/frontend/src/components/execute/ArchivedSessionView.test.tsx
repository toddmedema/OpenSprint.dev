import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArchivedSessionView } from "./ArchivedSessionView";

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
    render(<ArchivedSessionView sessions={sessions} />);

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
    render(<ArchivedSessionView sessions={sessions} />);

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
    render(<ArchivedSessionView sessions={sessions} />);

    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("1"); // Last session selected by default
    expect(screen.getByText("Second attempt")).toBeInTheDocument();
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
    render(<ArchivedSessionView sessions={sessions} />);

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
    render(<ArchivedSessionView sessions={sessions} />);

    expect(screen.getByText("Build timeout")).toBeInTheDocument();
  });

  it("returns null when sessions is empty", () => {
    const { container } = render(<ArchivedSessionView sessions={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
