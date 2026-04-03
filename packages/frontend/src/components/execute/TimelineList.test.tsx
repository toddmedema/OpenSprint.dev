import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, waitFor, within, render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import userEvent from "@testing-library/user-event";
import { TimelineList, TIMELINE_VIRTUALIZE_THRESHOLD } from "./TimelineList";
import { renderWithProviders, createTestStore, createTestQueryClient } from "../../test/test-utils";
import type { ComponentProps, RefObject } from "react";
import type { Task } from "@opensprint/shared";
import type { Plan } from "@opensprint/shared";
import { formatTimestamp, formatUptime } from "../../lib/formatting";

vi.mock("../../lib/formatting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/formatting")>();
  return {
    ...actual,
    formatUptime: vi.fn((startedAt: string) => `uptime:${startedAt}`),
    formatTimestamp: vi.fn((ts: string) => `relative:${ts}`),
  };
});

const mockUpdateTask = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    tasks: {
      updateTask: (...args: unknown[]) => mockUpdateTask(...args),
    },
  },
}));

const defaultListProps = {
  projectId: "proj-1",
  teamMembers: [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ],
};

const createMockTask = (
  overrides: Partial<{
    id: string;
    title: string;
    kanbanColumn: Task["kanbanColumn"];
    priority: number;
    assignee: string | null;
    epicId: string | null;
    updatedAt: string;
    createdAt: string;
    complexity: Task["complexity"];
    source: string;
    mergeGateState: Task["mergeGateState"];
    mergeWaitingOnMain: boolean;
    mergePausedUntil: string | null;
  }> = {}
): Task =>
  ({
    id: "task-1",
    title: "Task",
    description: "",
    type: "task",
    status: "open",
    priority: 1,
    assignee: null,
    labels: [],
    dependencies: [],
    epicId: "epic-1",
    kanbanColumn: "in_progress",
    createdAt: "2024-01-01T12:00:00Z",
    updatedAt: "2024-01-02T12:00:00Z",
    ...overrides,
  }) as Task;

/** Scroll host with explicit layout dimensions so @tanstack/react-virtual yields visible rows in jsdom. */
function renderTimelineInSizedScrollPort(
  props: Omit<ComponentProps<typeof TimelineList>, "scrollRef">,
  size: { width?: number; height?: number } = {}
) {
  const width = size.width ?? 800;
  const height = size.height ?? 480;
  const host = document.createElement("div");
  document.body.appendChild(host);
  Object.defineProperty(host, "offsetHeight", { value: height, configurable: true });
  Object.defineProperty(host, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: height, configurable: true });
  Object.defineProperty(host, "clientWidth", { value: width, configurable: true });
  host.style.overflow = "auto";
  host.style.height = `${height}px`;

  const scrollRef: RefObject<HTMLDivElement | null> = { current: host };
  const store = createTestStore();
  const queryClient = createTestQueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <TimelineList {...props} scrollRef={scrollRef} />
      </Provider>
    </QueryClientProvider>,
    { container: host, baseElement: document.body }
  );
  return { ...utils, host };
}

const createMockPlan = (epicId: string, title: string, status: Plan["status"] = "building"): Plan =>
  ({
    metadata: {
      planId: `plan-${epicId}`,
      epicId: epicId,
      shippedAt: null,
      complexity: "medium",
    },
    content: `# ${title}\n\nOverview`,
    status,
    taskCount: 1,
    doneTaskCount: 0,
    dependencyCount: 0,
  }) as Plan;

describe("TimelineList", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(formatUptime).mockImplementation((startedAt: string) => `uptime:${startedAt}`);
    vi.mocked(formatTimestamp).mockImplementation((ts: string) => `relative:${ts}`);
    mockUpdateTask.mockImplementation(
      (_projectId: string, taskId: string, updates: { assignee?: string | null }) =>
        Promise.resolve(createMockTask({ id: taskId, assignee: updates.assignee ?? null }) as never)
    );
  });

  it("renders section headers only for non-empty sections", () => {
    const tasks = [
      createMockTask({ id: "a", kanbanColumn: "in_progress", title: "Active Task" }),
      createMockTask({ id: "b", kanbanColumn: "done", title: "Done Task" }),
    ];
    const plans = [createMockPlan("epic-1", "Auth Epic")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    expect(screen.getByTestId("timeline-section-active")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-section-completed")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-section-ready")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timeline-section-in_line")).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Completed" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ready" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Up Next" })).not.toBeInTheDocument();
  });

  it("displays Ready section when ready tasks exist", () => {
    const tasks = [
      createMockTask({ id: "a", kanbanColumn: "in_progress", title: "Active Task" }),
      createMockTask({ id: "b", kanbanColumn: "ready", title: "Queued Task" }),
    ];
    const plans = [createMockPlan("epic-1", "Auth Epic")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    expect(screen.getByRole("heading", { name: "In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready" })).toBeInTheDocument();
    expect(screen.getByText("Queued Task")).toBeInTheDocument();
  });

  it("sorts Ready section rows by priority (agent order) instead of updatedAt recency", () => {
    const tasks = [
      createMockTask({
        id: "low-recent",
        title: "Low priority recent",
        kanbanColumn: "ready",
        priority: 3,
        createdAt: "2024-01-03T12:00:00Z",
        updatedAt: "2024-02-01T12:00:00Z",
      }),
      createMockTask({
        id: "high-older",
        title: "High priority older",
        kanbanColumn: "ready",
        priority: 1,
        createdAt: "2024-01-01T12:00:00Z",
        updatedAt: "2024-01-01T12:00:00Z",
      }),
    ];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={[]} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const readySection = screen.getByTestId("timeline-section-ready");
    const readyRows = within(readySection).getAllByTestId(/^timeline-row-/);
    expect(readyRows[0]).toHaveAttribute("data-testid", "timeline-row-high-older");
    expect(readyRows[1]).toHaveAttribute("data-testid", "timeline-row-low-recent");
  });

  it("displays Merge Queue section after In Progress when waiting_to_merge tasks exist", () => {
    const tasks = [
      createMockTask({ id: "a", kanbanColumn: "in_progress", title: "Active Task" }),
      createMockTask({
        id: "w",
        kanbanColumn: "waiting_to_merge",
        title: "Merge me",
      }),
    ];
    const plans = [createMockPlan("epic-1", "Auth Epic")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    expect(screen.getByTestId("timeline-section-waiting_to_merge")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Merge Queue" })).toBeInTheDocument();
    expect(screen.getByText("Merge me")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "In Progress" })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 });
    const inProgressIdx = headings.findIndex((h) => h.textContent === "In Progress");
    const waitingToMergeIdx = headings.findIndex((h) => h.textContent === "Merge Queue");
    expect(inProgressIdx).toBeLessThan(waitingToMergeIdx);

    const row = screen.getByTestId("timeline-row-w");
    expect(within(row).queryByTestId("timeline-waiting-to-merge-badge")).not.toBeInTheDocument();
  });

  it("waiting_to_merge row shows merge description instead of epic name", () => {
    const tasks = [
      createMockTask({
        id: "w",
        kanbanColumn: "waiting_to_merge",
        title: "Merge me",
        mergeGateState: "validating",
      }),
    ];
    const plans = [createMockPlan("epic-1", "Auth Epic")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const row = screen.getByTestId("timeline-row-w");
    expect(within(row).getByTestId("task-row-merge-description")).toHaveTextContent(
      "Running pre-merge checks"
    );
    expect(within(row).queryByTestId("task-row-epic-name")).not.toBeInTheDocument();
    expect(within(row).queryByText("Auth Epic")).not.toBeInTheDocument();
  });

  it("waiting_to_merge row does not show self-improvement badge (merge queue chrome only)", () => {
    const tasks = [
      createMockTask({
        id: "w",
        kanbanColumn: "waiting_to_merge",
        title: "SI merge task",
        source: "self-improvement",
      }),
    ];
    const plans = [createMockPlan("epic-1", "Auth Epic")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const row = screen.getByTestId("timeline-row-w");
    expect(within(row).queryByTestId("task-badge-self-improvement")).not.toBeInTheDocument();
    expect(within(row).getByTestId("task-row-merge-description")).toBeInTheDocument();
  });

  it("non-merge row still shows epic name", () => {
    const tasks = [
      createMockTask({
        id: "r",
        kanbanColumn: "ready",
        title: "Ready task",
        epicId: "epic-1",
      }),
    ];
    const plans = [createMockPlan("epic-1", "Auth Epic")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const row = screen.getByTestId("timeline-row-r");
    expect(within(row).getByTestId("task-row-epic-name")).toHaveTextContent("Auth Epic");
    expect(within(row).queryByTestId("task-row-merge-description")).not.toBeInTheDocument();
  });

  it("waiting_to_merge row includes blocked-on-main with retry eligibility when paused", () => {
    vi.useFakeTimers({ now: new Date("2024-06-01T12:00:00Z").getTime() });

    const tasks = [
      createMockTask({
        id: "w",
        kanbanColumn: "waiting_to_merge",
        title: "Backoff merge",
        mergeWaitingOnMain: true,
        mergePausedUntil: "2024-06-01T12:07:00Z",
      }),
    ];
    const plans = [createMockPlan("epic-1", "Auth Epic")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const row = screen.getByTestId("timeline-row-w");
    expect(within(row).getByTestId("task-row-merge-description")).toHaveTextContent(
      "Blocked on main baseline checks • Retry eligible in 7m"
    );
  });

  it("displays Up Next section when backlog/planning tasks exist", () => {
    const tasks = [
      createMockTask({ id: "a", kanbanColumn: "in_progress", title: "Active Task" }),
      createMockTask({ id: "b", kanbanColumn: "backlog", title: "Blocked Task" }),
    ];
    const plans = [createMockPlan("epic-1", "Auth Epic")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    expect(screen.getByRole("heading", { name: "In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Up Next" })).toBeInTheDocument();
    expect(screen.getByText("Blocked Task")).toBeInTheDocument();
  });

  it("displays Planning section above Completed when tasks belong to plans in planning status", () => {
    const tasks = [
      createMockTask({ id: "a", kanbanColumn: "done", title: "Done Task", epicId: "epic-done" }),
      createMockTask({
        id: "b",
        kanbanColumn: "ready",
        title: "Planning Plan Task",
        epicId: "epic-planning",
      }),
    ];
    const plans = [
      createMockPlan("epic-done", "Done Epic", "complete"),
      createMockPlan("epic-planning", "Planning Epic", "planning"),
    ];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Completed" })).toBeInTheDocument();
    expect(screen.getByText("Planning Plan Task")).toBeInTheDocument();
    expect(screen.getByText("Done Task")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 });
    const planningIdx = headings.findIndex((h) => h.textContent === "Planning");
    const completedIdx = headings.findIndex((h) => h.textContent === "Completed");
    expect(planningIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThanOrEqual(0);
    expect(planningIdx).toBeLessThan(completedIdx);
  });

  it("rows display priority icon, title, and epic name (no row status icon; section header shows status)", () => {
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "Implement login",
        kanbanColumn: "in_progress",
        priority: 0,
        epicId: "epic-1",
      }),
    ];
    const plans = [createMockPlan("epic-1", "Authentication")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    expect(screen.getByText("Implement login")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /critical/i })).toBeInTheDocument();
    expect(screen.getByText("Authentication")).toBeInTheDocument();
  });

  it("marks the selected task row for sidebar/detail context", () => {
    const tasks = [
      createMockTask({
        id: "task-a",
        title: "First task",
        kanbanColumn: "ready",
        epicId: "epic-1",
      }),
      createMockTask({
        id: "task-b",
        title: "Second task",
        kanbanColumn: "ready",
        epicId: "epic-1",
      }),
    ];
    const plans = [createMockPlan("epic-1", "Shared Epic")];

    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={plans}
        onTaskSelect={vi.fn()}
        selectedTaskId="task-b"
        {...defaultListProps}
      />
    );

    const rowA = screen.getByTestId("timeline-row-task-a");
    const rowB = screen.getByTestId("timeline-row-task-b");
    expect(rowA).toHaveAttribute("data-queue-row-selected", "false");
    expect(rowB).toHaveAttribute("data-queue-row-selected", "true");
    expect(rowB).toHaveAttribute("aria-current", "true");
    expect(rowA).not.toHaveAttribute("aria-current");
  });

  it("displays epic name in timeline rows when task has an associated plan", () => {
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "Task with epic",
        kanbanColumn: "ready",
        epicId: "epic-1",
      }),
    ];
    const plans = [createMockPlan("epic-1", "Auth Epic")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    expect(screen.getByText("Task with epic")).toBeInTheDocument();
    expect(screen.getByText("Auth Epic")).toBeInTheDocument();
    expect(screen.getByTestId("task-row-epic-name")).toHaveTextContent("Auth Epic");
  });

  it("does not render epic name element when task has no epicId", () => {
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "Task without epic",
        kanbanColumn: "ready",
        epicId: null,
      }),
    ];
    const plans: Plan[] = [];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    expect(screen.getByText("Task without epic")).toBeInTheDocument();
    expect(screen.queryByTestId("task-row-epic-name")).not.toBeInTheDocument();
  });

  it("epic name has truncation class and wider max on >=1000px viewports", () => {
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "Task with epic",
        kanbanColumn: "ready",
        epicId: "epic-1",
      }),
    ];
    const plans = [createMockPlan("epic-1", "Auth Epic")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const epicNameEl = screen.getByTestId("task-row-epic-name");
    expect(epicNameEl).toHaveClass("truncate", "max-w-[120px]");
    expect(epicNameEl.className).toContain("min-[1000px]:max-w-[240px]");
  });

  it("shows Self-improvement badge for tasks with source self-improvement", () => {
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "Improve tests",
        kanbanColumn: "ready",
        source: "self-improvement",
      }),
      createMockTask({ id: "task-2", title: "Regular task", kanbanColumn: "ready" }),
    ];
    const plans = [createMockPlan("epic-1", "Auth")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const badges = screen.getAllByTestId("task-badge-self-improvement");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("Self-improvement");
    expect(badges[0].className).not.toMatch(/\bbg-/);
    expect(screen.getByText("Improve tests")).toBeInTheDocument();
  });

  it("hides Self-improvement badge on small screens (epic name remains visible)", () => {
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "Improve tests",
        kanbanColumn: "ready",
        source: "self-improvement",
      }),
    ];
    const plans = [createMockPlan("epic-1", "Auth Epic")];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const badge = screen.getByTestId("task-badge-self-improvement");
    expect(badge).toHaveClass("hidden");
    expect(badge).toHaveClass("md:inline");
  });

  it("click calls onTaskSelect with correct ID", async () => {
    const user = userEvent.setup();
    const onTaskSelect = vi.fn();
    const tasks = [createMockTask({ id: "task-xyz", title: "Click me", kanbanColumn: "ready" })];
    const plans: Plan[] = [];

    renderWithProviders(
      <TimelineList tasks={tasks} plans={plans} onTaskSelect={onTaskSelect} {...defaultListProps} />
    );

    await user.click(screen.getByText("Click me"));

    expect(onTaskSelect).toHaveBeenCalledWith("task-xyz");
  });

  it("blocked row shows Retry button", async () => {
    const user = userEvent.setup();
    const onUnblock = vi.fn();
    const tasks = [
      createMockTask({ id: "blocked-1", title: "Blocked task", kanbanColumn: "blocked" }),
    ];
    const plans: Plan[] = [];

    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={plans}
        onTaskSelect={vi.fn()}
        onUnblock={onUnblock}
        {...defaultListProps}
      />
    );

    const unblockBtn = screen.getByRole("button", { name: "Retry" });
    expect(unblockBtn).toBeInTheDocument();

    await user.click(unblockBtn);
    expect(onUnblock).toHaveBeenCalledWith("blocked-1");
  });

  it("shows Failures section at top when statusFilter is all and blocked tasks exist", () => {
    const tasks = [
      createMockTask({ id: "blocked-1", title: "Blocked task", kanbanColumn: "blocked" }),
      createMockTask({ id: "ready-1", title: "Ready task", kanbanColumn: "ready" }),
    ];
    const plans = [createMockPlan("epic-1", "Auth")];

    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={plans}
        onTaskSelect={vi.fn()}
        statusFilter="all"
        {...defaultListProps}
      />
    );

    expect(screen.getByTestId("timeline-section-blocked")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Failures" })).toBeInTheDocument();
    expect(screen.getByText("Blocked task")).toBeInTheDocument();
    const sections = screen.getAllByRole("heading", { level: 3 });
    expect(sections[0]).toHaveTextContent("Failures");
  });

  it("hides Failures section when no blocked tasks", () => {
    const tasks = [
      createMockTask({ id: "ready-1", title: "Ready task", kanbanColumn: "ready" }),
      createMockTask({ id: "done-1", title: "Done task", kanbanColumn: "done" }),
    ];
    const plans = [createMockPlan("epic-1", "Auth")];

    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={plans}
        onTaskSelect={vi.fn()}
        statusFilter="all"
        {...defaultListProps}
      />
    );

    expect(screen.queryByTestId("timeline-section-blocked")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Failures" })).not.toBeInTheDocument();
  });

  it("blocked tasks appear only in Failures section, not duplicated in Ready", () => {
    const tasks = [
      createMockTask({ id: "blocked-1", title: "Blocked task", kanbanColumn: "blocked" }),
      createMockTask({ id: "ready-1", title: "Ready task", kanbanColumn: "ready" }),
    ];
    const plans = [createMockPlan("epic-1", "Auth")];

    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={plans}
        onTaskSelect={vi.fn()}
        statusFilter="all"
        {...defaultListProps}
      />
    );

    expect(screen.getByTestId("timeline-section-blocked")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-section-ready")).toBeInTheDocument();
    expect(screen.getByText("Blocked task")).toBeInTheDocument();
    expect(screen.getByText("Ready task")).toBeInTheDocument();

    const blockedSection = screen.getByTestId("timeline-section-blocked");
    const readySection = screen.getByTestId("timeline-section-ready");
    expect(blockedSection).toContainElement(screen.getByTestId("timeline-row-blocked-1"));
    expect(readySection).not.toContainElement(screen.getByTestId("timeline-row-blocked-1"));
    expect(readySection).toContainElement(screen.getByTestId("timeline-row-ready-1"));
  });

  it("shows only failed tickets when statusFilter is blocked (Failures filter)", () => {
    const tasks = [
      createMockTask({ id: "blocked-1", title: "Blocked task", kanbanColumn: "blocked" }),
      createMockTask({ id: "blocked-2", title: "Another blocked", kanbanColumn: "blocked" }),
    ];
    const plans = [createMockPlan("epic-1", "Auth")];

    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={plans}
        onTaskSelect={vi.fn()}
        statusFilter="blocked"
        {...defaultListProps}
      />
    );

    expect(screen.getByTestId("timeline-section-blocked")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Failures" })).toBeInTheDocument();
    expect(screen.getByText("Blocked task")).toBeInTheDocument();
    expect(screen.getByText("Another blocked")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^timeline-row-/)).toHaveLength(2);
  });

  it("renders sticky section headers consistently when scrollRef is provided", () => {
    const tasks = Array.from({ length: 30 }, (_, index) =>
      createMockTask({
        id: `task-${index}`,
        title: `Task ${index}`,
        kanbanColumn: index % 2 === 0 ? "in_progress" : "ready",
      })
    );
    const plans = [createMockPlan("epic-1", "Auth")];
    const scrollRef = { current: document.createElement("div") };

    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={plans}
        onTaskSelect={vi.fn()}
        scrollRef={scrollRef}
        statusFilter="all"
        {...defaultListProps}
      />
    );

    expect(screen.getByTestId("timeline-list")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-row-task-0")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready" })).toBeInTheDocument();

    const activeSection = screen.getByTestId("timeline-section-active");
    const readySection = screen.getByTestId("timeline-section-ready");
    expect(activeSection.querySelector(".sticky")).toBeInTheDocument();
    expect(readySection.querySelector(".sticky")).toBeInTheDocument();
  });

  it("empty tasks array renders nothing", () => {
    const plans = [createMockPlan("epic-1", "Auth")];

    const { container } = renderWithProviders(
      <TimelineList tasks={[]} plans={plans} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    expect(screen.queryByTestId("timeline-list")).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it("renders timeline-list container with data-testid", () => {
    const tasks = [createMockTask({ id: "t1", kanbanColumn: "ready" })];
    renderWithProviders(
      <TimelineList tasks={tasks} plans={[]} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    expect(screen.getByTestId("timeline-list")).toBeInTheDocument();
  });

  it("section headers are sticky so they stay visible when scrolling", () => {
    const tasks = [
      createMockTask({ id: "a", kanbanColumn: "in_progress" }),
      createMockTask({ id: "b", kanbanColumn: "done" }),
    ];
    renderWithProviders(
      <TimelineList tasks={tasks} plans={[]} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const activeSection = screen.getByTestId("timeline-section-active");
    const completedSection = screen.getByTestId("timeline-section-completed");
    const stickyWrapper = activeSection.querySelector(".sticky");
    expect(stickyWrapper).toBeInTheDocument();
    expect(stickyWrapper).toHaveClass("z-[12]", "backdrop-blur-sm", "bg-theme-bg/95");
    expect(stickyWrapper?.className).toContain("top-0");
    expect(stickyWrapper?.className).toContain("[background-clip:padding-box]");
    expect(completedSection.querySelector(".sticky")).toBeInTheDocument();
  });

  it("sticky section headers render on first load with many tasks and a scroll container", () => {
    const tasks = Array.from({ length: 40 }, (_, i) =>
      createMockTask({
        id: `task-${i}`,
        title: `Task ${i}`,
        kanbanColumn: i < 15 ? "in_progress" : i < 30 ? "ready" : "done",
      })
    );
    const plans = [createMockPlan("epic-1", "Auth")];
    const scrollRef = { current: document.createElement("div") };

    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={plans}
        onTaskSelect={vi.fn()}
        scrollRef={scrollRef}
        statusFilter="all"
        {...defaultListProps}
      />
    );

    const allSections = screen.getAllByTestId(/^timeline-section-/);
    for (const section of allSections) {
      const sticky = section.querySelector(".sticky");
      expect(sticky).toBeInTheDocument();
      expect(sticky).toHaveClass("z-[12]");
    }

    expect(screen.getByRole("heading", { name: "In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Completed" })).toBeInTheDocument();
  });

  it("renders timeline-row-{taskId} on each row", () => {
    const tasks = [
      createMockTask({ id: "task-a", kanbanColumn: "in_progress" }),
      createMockTask({ id: "task-b", kanbanColumn: "done" }),
    ];
    renderWithProviders(
      <TimelineList tasks={tasks} plans={[]} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    expect(screen.getByTestId("timeline-row-task-a")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-row-task-b")).toBeInTheDocument();
  });

  it("when enableHumanTeammates is false shows assignee as text only (no dropdown)", () => {
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "Ready task",
        kanbanColumn: "ready",
        assignee: "Frodo",
      }),
    ];
    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={[]}
        onTaskSelect={vi.fn()}
        {...defaultListProps}
        enableHumanTeammates={false}
      />
    );
    expect(screen.getByTestId("task-row-assignee")).toHaveTextContent("Frodo");
    expect(screen.queryByTestId("assignee-dropdown-trigger")).not.toBeInTheDocument();
  });

  it("when enableHumanTeammates is false omits assignee em dash for unassigned task", () => {
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "Ready task",
        kanbanColumn: "ready",
        assignee: null,
      }),
    ];
    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={[]}
        onTaskSelect={vi.fn()}
        {...defaultListProps}
        enableHumanTeammates={false}
      />
    );
    expect(screen.getByTestId("task-row-assignee")).toBeInTheDocument();
    expect(screen.getByTestId("task-row-assignee")).toHaveTextContent("");
    expect(screen.queryByTestId("assignee-dropdown-trigger")).not.toBeInTheDocument();
  });

  it("task row shows assignee; click opens dropdown; selection updates task", async () => {
    const user = userEvent.setup();
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "Assign me",
        kanbanColumn: "ready",
        assignee: null,
      }),
    ];
    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={[]}
        onTaskSelect={vi.fn()}
        {...defaultListProps}
        enableHumanTeammates={true}
      />
    );

    expect(screen.getByTestId("task-row-assignee")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();

    await user.click(screen.getByTestId("assignee-dropdown-trigger"));
    expect(screen.getByTestId("assignee-dropdown")).toBeInTheDocument();

    await user.click(screen.getByTestId("assignee-option-alice"));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith("proj-1", "task-1", {
        assignee: "Alice",
      });
    });
  });

  it("does not show assignee dropdown trigger for in-progress task (assignee locked)", () => {
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "In progress",
        kanbanColumn: "in_progress",
        assignee: "Frodo",
      }),
    ];
    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={[]}
        onTaskSelect={vi.fn()}
        {...defaultListProps}
        enableHumanTeammates={true}
      />
    );

    expect(screen.getByTestId("task-row-assignee")).toBeInTheDocument();
    expect(screen.getByText("Frodo")).toBeInTheDocument();
    expect(screen.queryByTestId("assignee-dropdown-trigger")).not.toBeInTheDocument();
  });

  it("updates active rows every 10s and inactive rows every 30s without selection changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-16T12:00:00.000Z"));

    const actualFormatting =
      await vi.importActual<typeof import("../../lib/formatting")>("../../lib/formatting");
    vi.mocked(formatUptime).mockImplementation((startedAt: string, now?: Date) =>
      actualFormatting.formatUptime(startedAt, now)
    );
    vi.mocked(formatTimestamp).mockImplementation((ts: string, now?: Date) =>
      actualFormatting.formatTimestamp(ts, now)
    );

    const tasks = [
      createMockTask({
        id: "active-task",
        title: "Active task",
        kanbanColumn: "in_progress",
        updatedAt: "2026-02-16T11:59:55.000Z",
      }),
      createMockTask({
        id: "ready-task",
        title: "Ready task",
        kanbanColumn: "ready",
        updatedAt: "2026-02-16T11:58:30.000Z",
      }),
    ];

    renderWithProviders(
      <TimelineList
        tasks={tasks}
        plans={[]}
        onTaskSelect={vi.fn()}
        taskIdToStartedAt={{ "active-task": "2026-02-16T11:59:55.000Z" }}
        selectedTaskId="active-task"
        scrollRef={{ current: document.createElement("div") }}
        {...defaultListProps}
      />
    );

    expect(screen.getByText("5s")).toBeInTheDocument();
    expect(screen.getByText("1m ago")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText("15s")).toBeInTheDocument();
    expect(screen.getByText("1m ago")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getByText("2m ago")).toBeInTheDocument();
  });

  it("does not set data-timeline-virtualized when task count is at threshold", () => {
    const tasks = Array.from({ length: TIMELINE_VIRTUALIZE_THRESHOLD }, (_, i) =>
      createMockTask({ id: `t-${i}`, kanbanColumn: "ready", title: `Task ${i}` })
    );
    renderWithProviders(
      <TimelineList tasks={tasks} plans={[]} onTaskSelect={vi.fn()} {...defaultListProps} />
    );
    expect(screen.getByTestId("timeline-list")).not.toHaveAttribute("data-timeline-virtualized");
  });

  it("virtualizes task rows when count exceeds threshold and scrollport reports size", () => {
    const n = TIMELINE_VIRTUALIZE_THRESHOLD + 12;
    const tasks = Array.from({ length: n }, (_, i) =>
      createMockTask({ id: `task-${i}`, kanbanColumn: "ready", title: `Task ${i}` })
    );
    const { unmount, host } = renderTimelineInSizedScrollPort(
      { tasks, plans: [], onTaskSelect: vi.fn(), ...defaultListProps },
      { height: 220, width: 640 }
    );

    try {
      const list = screen.getByTestId("timeline-list");
      expect(list).toHaveAttribute("data-timeline-virtualized", "true");
      expect(list).toHaveAttribute("role", "list");
      const items = within(list).getAllByRole("listitem");
      expect(items.length).toBeGreaterThan(0);
      const rows = screen.queryAllByTestId(/^timeline-row-/);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(n);
    } finally {
      unmount();
      host.remove();
    }
  });

  it("all task rows have consistent min-h-[52px] regardless of position", () => {
    const tasks = [
      createMockTask({ id: "t-first", kanbanColumn: "ready", title: "First" }),
      createMockTask({ id: "t-mid", kanbanColumn: "ready", title: "Middle" }),
      createMockTask({ id: "t-last", kanbanColumn: "ready", title: "Last" }),
    ];
    renderWithProviders(
      <TimelineList tasks={tasks} plans={[]} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const rows = screen.getAllByTestId(/^timeline-row-/);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toHaveClass("min-h-[52px]");
    }
  });

  it("section headers do not add extra bottom margin above first task row", () => {
    const tasks = [
      createMockTask({ id: "a", kanbanColumn: "in_progress", title: "Active" }),
      createMockTask({ id: "b", kanbanColumn: "ready", title: "Ready" }),
    ];
    renderWithProviders(
      <TimelineList tasks={tasks} plans={[]} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const activeSection = screen.getByTestId("timeline-section-active");
    const readySection = screen.getByTestId("timeline-section-ready");

    for (const section of [activeSection, readySection]) {
      const header = section.querySelector("div.sticky") ?? section.querySelector("div");
      expect(header).toBeTruthy();
      expect(header!.className).not.toContain("mb-[7px]");
      expect(header!.className).not.toContain("mb-[");
    }
  });

  it("first and middle rows within a section share the same padding class", () => {
    const tasks = [
      createMockTask({ id: "r1", kanbanColumn: "ready", title: "Row 1" }),
      createMockTask({ id: "r2", kanbanColumn: "ready", title: "Row 2" }),
      createMockTask({ id: "r3", kanbanColumn: "ready", title: "Row 3" }),
    ];
    renderWithProviders(
      <TimelineList tasks={tasks} plans={[]} onTaskSelect={vi.fn()} {...defaultListProps} />
    );

    const rows = screen.getAllByTestId(/^timeline-row-/);
    const paddingClasses = rows.map((row) => {
      const inner = row.querySelector(".py-2\\.5");
      return inner !== null;
    });
    expect(paddingClasses.every(Boolean)).toBe(true);
  });

  it("virtualized rows all have min-h-[52px] wrapper", () => {
    const n = TIMELINE_VIRTUALIZE_THRESHOLD + 5;
    const tasks = Array.from({ length: n }, (_, i) =>
      createMockTask({ id: `task-${i}`, kanbanColumn: "ready", title: `Task ${i}` })
    );
    const { unmount, host } = renderTimelineInSizedScrollPort(
      { tasks, plans: [], onTaskSelect: vi.fn(), ...defaultListProps },
      { height: 600, width: 640 }
    );

    try {
      const list = screen.getByTestId("timeline-list");
      expect(list).toHaveAttribute("data-timeline-virtualized", "true");
      const rows = screen.queryAllByTestId(/^timeline-row-/);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).toHaveClass("min-h-[52px]");
      }
    } finally {
      unmount();
      host.remove();
    }
  });

  it("virtualized section headers do not have bottom margin", () => {
    const n = TIMELINE_VIRTUALIZE_THRESHOLD + 5;
    const tasks = Array.from({ length: n }, (_, i) =>
      createMockTask({ id: `task-${i}`, kanbanColumn: "ready", title: `Task ${i}` })
    );
    const { unmount, host } = renderTimelineInSizedScrollPort(
      { tasks, plans: [], onTaskSelect: vi.fn(), ...defaultListProps },
      { height: 600, width: 640 }
    );

    try {
      const section = screen.getByTestId("timeline-section-ready");
      const headerDiv = section.querySelector("div");
      expect(headerDiv).toBeTruthy();
      expect(headerDiv!.className).not.toContain("mb-[");
    } finally {
      unmount();
      host.remove();
    }
  });

  it("virtualized mode omits sticky class on section headers", () => {
    const n = TIMELINE_VIRTUALIZE_THRESHOLD + 5;
    const tasks = Array.from({ length: n }, (_, i) =>
      createMockTask({ id: `task-${i}`, kanbanColumn: "ready", title: `Task ${i}` })
    );
    const { unmount, host } = renderTimelineInSizedScrollPort(
      { tasks, plans: [], onTaskSelect: vi.fn(), ...defaultListProps },
      { height: 240, width: 640 }
    );

    try {
      expect(screen.getByTestId("timeline-list")).toHaveAttribute(
        "data-timeline-virtualized",
        "true"
      );
      const section = screen.getByTestId("timeline-section-ready");
      expect(section.querySelector(".sticky")).toBeNull();
    } finally {
      unmount();
      host.remove();
    }
  });
});
