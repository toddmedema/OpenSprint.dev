import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { SourceFeedbackSection } from "./SourceFeedbackSection";
import notificationReducer from "../../store/slices/notificationSlice";

const mockFeedbackGet = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    feedback: {
      get: (...args: unknown[]) => mockFeedbackGet(...args),
    },
  },
}));

function createStore() {
  return configureStore({
    reducer: { notification: notificationReducer },
  });
}

describe("SourceFeedbackSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeedbackGet.mockResolvedValue(null);
  });

  it("renders collapsible header with Source Feedback label", () => {
    render(
      <Provider store={createStore()}>
        <SourceFeedbackSection
          projectId="proj-1"
          feedbackId="fb-1"
          plans={[]}
          expanded={false}
          onToggle={() => {}}
        />
      </Provider>,
    );

    expect(screen.getByRole("button", { name: /source feedback/i })).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("calls onToggle when header is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <Provider store={createStore()}>
        <SourceFeedbackSection
          projectId="proj-1"
          feedbackId="fb-1"
          plans={[]}
          expanded={false}
          onToggle={onToggle}
        />
      </Provider>,
    );

    await user.click(screen.getByRole("button", { name: /source feedback/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("fetches and displays feedback when expanded", async () => {
    mockFeedbackGet.mockResolvedValue({
      id: "fb-1",
      text: "Add dark mode support",
      category: "feature",
      mappedPlanId: "plan-1",
      createdTaskIds: [],
      status: "mapped",
      createdAt: "2026-02-17T10:00:00Z",
    });
    const plans = [
      {
        metadata: { planId: "plan-1", beadEpicId: "epic-1", gateTaskId: "epic-1.0", complexity: "medium" as const },
        content: "# Dark Mode",
        status: "building" as const,
        taskCount: 1,
        doneTaskCount: 0,
        dependencyCount: 0,
      },
    ];

    render(
      <Provider store={createStore()}>
        <SourceFeedbackSection
          projectId="proj-1"
          feedbackId="fb-1"
          plans={plans}
          expanded={true}
          onToggle={() => {}}
        />
      </Provider>,
    );

    expect(await screen.findByText("Add dark mode support")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
    expect(screen.getByTestId("source-feedback-card")).toBeInTheDocument();
  });

  it("shows Resolved chip when feedback status is resolved", async () => {
    mockFeedbackGet.mockResolvedValue({
      id: "fb-1",
      text: "Fixed bug",
      category: "bug",
      mappedPlanId: null,
      createdTaskIds: [],
      status: "resolved",
      createdAt: "2026-02-17T10:00:00Z",
    });

    render(
      <Provider store={createStore()}>
        <SourceFeedbackSection
          projectId="proj-1"
          feedbackId="fb-1"
          plans={[]}
          expanded={true}
          onToggle={() => {}}
        />
      </Provider>,
    );

    expect(await screen.findByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Bug")).toBeInTheDocument();
  });

  it("does not fetch when collapsed", () => {
    render(
      <Provider store={createStore()}>
        <SourceFeedbackSection
          projectId="proj-1"
          feedbackId="fb-1"
          plans={[]}
          expanded={false}
          onToggle={() => {}}
        />
      </Provider>,
    );

    expect(mockFeedbackGet).not.toHaveBeenCalled();
  });
});
