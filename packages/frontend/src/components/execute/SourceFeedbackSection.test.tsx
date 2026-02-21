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

  it("uses same content wrapper and container styling as Live Output (p-4 pt-0, bg-theme-code-bg)", async () => {
    mockFeedbackGet.mockResolvedValue({
      id: "fb-1",
      text: "Test feedback",
      category: "bug",
      mappedPlanId: null,
      createdTaskIds: [],
      status: "mapped",
      createdAt: "2026-02-17T10:00:00Z",
    });

    const { container } = render(
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

    await screen.findByText("Test feedback");

    const contentRegion = container.querySelector("#source-feedback-content");
    expect(contentRegion).toBeInTheDocument();
    expect(contentRegion).toHaveClass("p-4", "pt-0");

    const card = screen.getByTestId("source-feedback-card");
    expect(card).toHaveClass("bg-theme-code-bg", "rounded-lg", "border", "border-theme-border", "overflow-hidden", "p-4");
  });

  it("renders feedback category chip and Mapped plan when mappedPlanId and plans provided", async () => {
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

    await screen.findByText("Add dark mode support");
    expect(screen.getByText("Feature")).toBeInTheDocument();
    expect(screen.getByText(/mapped plan:/i)).toBeInTheDocument();
    expect(screen.getByText(/Dark Mode/)).toBeInTheDocument();
  });

  it("shows loading state with matching container styling", () => {
    mockFeedbackGet.mockImplementation(() => new Promise(() => {}));

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

    expect(screen.getByTestId("source-feedback-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading feedback…")).toBeInTheDocument();
  });
});
