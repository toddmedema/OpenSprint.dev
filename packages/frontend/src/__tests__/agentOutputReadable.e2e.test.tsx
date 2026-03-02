/**
 * E2E test: run a task, verify live output shows formatted text (no raw JSON),
 * and archived output is formatted. Assert markdown elements (code block, list)
 * are present when agent emits markdown.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureStore } from "@reduxjs/toolkit";
import { ExecutePhase } from "../pages/phases/ExecutePhase";
import { appendAgentOutput } from "../store/slices/executeSlice";
import { agentOutputFilterMiddleware } from "../store/middleware/agentOutputFilterMiddleware";
import projectReducer from "../store/slices/projectSlice";
import planReducer from "../store/slices/planSlice";
import executeReducer, { initialExecuteState } from "../store/slices/executeSlice";
import evalReducer from "../store/slices/evalSlice";
import websocketReducer from "../store/slices/websocketSlice";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const mockGet = vi.fn();
const mockSessions = vi.fn();
const mockLiveOutput = vi.fn();
const mockAgentsActive = vi.fn();
const mockTaskDiagnostics = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    tasks: {
      list: vi.fn().mockResolvedValue([]),
      get: (...args: unknown[]) => mockGet(...args),
      sessions: (...args: unknown[]) => mockSessions(...args),
      markDone: vi.fn().mockResolvedValue(undefined),
      unblock: vi.fn().mockResolvedValue({ taskUnblocked: true }),
    },
    plans: {
      list: vi.fn().mockResolvedValue({ plans: [], edges: [] }),
    },
    execute: {
      status: vi.fn().mockResolvedValue({}),
      liveOutput: (...args: unknown[]) => mockLiveOutput(...args),
      taskDiagnostics: (...args: unknown[]) => mockTaskDiagnostics(...args),
    },
    agents: {
      active: (...args: unknown[]) => mockAgentsActive(...args),
    },
    feedback: {
      get: vi.fn().mockResolvedValue(null),
    },
    notifications: {
      listByProject: vi.fn().mockResolvedValue([]),
    },
  },
}));

const basePlan = {
  metadata: {
    planId: "plan-1",
    epicId: "epic-1",
    complexity: "medium" as const,
  },
  content: "# Plan",
  status: "building" as const,
  taskCount: 1,
  doneTaskCount: 0,
  dependencyCount: 0,
};

function createStoreWithFilterMiddleware(preloadedState: {
  tasks: Array<{
    id: string;
    title: string;
    epicId: string;
    kanbanColumn: string;
    priority: number;
    assignee: string | null;
  }>;
  selectedTaskId: string;
  agentOutput?: Record<string, string[]>;
  wsConnected?: boolean;
  isDoneTask?: boolean;
  archivedSessions?: Array<{
    attempt: number;
    status: string;
    agentType: string;
    outputLog: string;
    gitDiff: string | null;
    testResults: { passed: number; failed: number; skipped: number; total: number } | null;
    failureReason: string | null;
  }>;
  completionState?: { status: string; testResults: unknown; reason?: string | null } | null;
}) {
  return configureStore({
    reducer: {
      project: projectReducer,
      plan: planReducer,
      execute: executeReducer,
      eval: evalReducer,
      websocket: websocketReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: { ignoredActions: ["ws/connect", "ws/disconnect", "ws/send"] },
      }).concat(agentOutputFilterMiddleware),
    preloadedState: {
      websocket: {
        connected: preloadedState.wsConnected ?? true,
        deliverToast: null,
      },
      plan: {
        plans: [basePlan],
        dependencyGraph: null,
        selectedPlanId: null,
        chatMessages: {},
        loading: false,
        decomposing: false,
        executingPlanId: null,
        reExecutingPlanId: null,
        archivingPlanId: null,
        error: null,
      },
      execute: {
        ...initialExecuteState,
        tasks: preloadedState.tasks,
        selectedTaskId: preloadedState.selectedTaskId,
        agentOutput: preloadedState.agentOutput ?? {},
        archivedSessions: preloadedState.archivedSessions ?? [],
        completionState: preloadedState.completionState ?? null,
      },
    },
  });
}

describe("E2E: Readable agent output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      id: "epic-1.1",
      title: "Implement feature",
      epicId: "epic-1",
      kanbanColumn: "in_progress",
      priority: 0,
      assignee: "agent",
      description: "",
      type: "task",
      status: "in_progress",
      labels: [],
      dependencies: [],
      createdAt: "",
      updatedAt: "",
    });
    mockSessions.mockResolvedValue([]);
    mockLiveOutput.mockResolvedValue({ output: "" });
    mockAgentsActive.mockResolvedValue([]);
    mockTaskDiagnostics.mockResolvedValue(null);
  });

  it("live output shows formatted text, not raw JSON, when agent emits NDJSON", async () => {
    const tasks = [
      {
        id: "epic-1.1",
        title: "Implement feature",
        epicId: "epic-1",
        kanbanColumn: "in_progress",
        priority: 0,
        assignee: "agent",
      },
    ];
    const store = createStoreWithFilterMiddleware({
      tasks,
      selectedTaskId: "epic-1.1",
      wsConnected: true,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Provider store={store}>
            <ExecutePhase projectId="proj-1" />
          </Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith("proj-1", "epic-1.1");
    });

    // Simulate agent emitting raw NDJSON (as WebSocket would)
    await act(async () => {
      store.dispatch(
        appendAgentOutput({
          taskId: "epic-1.1",
          chunk: '{"type":"text","text":"Hello from agent"}\n{"type":"tool_use","name":"edit"}\n{"type":"text","text":" **bold** and `code`"}\n',
        })
      );
    });

    await waitFor(() => {
      const liveOutput = screen.getByTestId("live-agent-output");
      expect(liveOutput).toHaveTextContent("Hello from agent");
    });
    const liveOutput = screen.getByTestId("live-agent-output");
    expect(liveOutput).toHaveTextContent("bold");
    expect(liveOutput).toHaveTextContent("code");
    // Raw JSON must NOT appear
    expect(liveOutput).not.toHaveTextContent("tool_use");
    expect(liveOutput).not.toHaveTextContent('"type":"text"');
  });

  it("live output renders markdown elements (code block, list) when agent emits markdown", async () => {
    const tasks = [
      {
        id: "epic-1.1",
        title: "Implement feature",
        epicId: "epic-1",
        kanbanColumn: "in_progress",
        priority: 0,
        assignee: "agent",
      },
    ];
    const store = createStoreWithFilterMiddleware({
      tasks,
      selectedTaskId: "epic-1.1",
      wsConnected: true,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Provider store={store}>
            <ExecutePhase projectId="proj-1" />
          </Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith("proj-1", "epic-1.1");
    });

    const markdownContent =
      "```\nconst x = 42;\n```\n\n- Item one\n- Item two\n\n**Bold text**";
    await act(async () => {
      store.dispatch(
        appendAgentOutput({
          taskId: "epic-1.1",
          chunk: JSON.stringify({ type: "text", text: markdownContent }) + "\n",
        })
      );
    });

    await waitFor(() => {
      const liveOutput = screen.getByTestId("live-agent-output");
      expect(liveOutput).toHaveTextContent("const x = 42;");
    });
    const liveOutput = screen.getByTestId("live-agent-output");
    // Code block content
    expect(liveOutput).toHaveTextContent("const x = 42;");
    // List items
    expect(liveOutput).toHaveTextContent("Item one");
    expect(liveOutput).toHaveTextContent("Item two");
    // Bold
    expect(liveOutput).toHaveTextContent("Bold text");
    // Markdown structure: pre/code for code block, ul/li for list
    expect(liveOutput.querySelector("pre")).toBeInTheDocument();
    expect(liveOutput.querySelector("code")).toBeInTheDocument();
    expect(liveOutput.querySelector("ul")).toBeInTheDocument();
    expect(liveOutput.querySelectorAll("li").length).toBeGreaterThanOrEqual(2);
  });

  it("archived output shows formatted text, not raw JSON", async () => {
    const archivedSessions = [
      {
        attempt: 1,
        status: "approved",
        agentType: "coder",
        outputLog:
          '{"type":"text","text":"Visible output"}\n{"type":"tool_use","name":"edit"}\n{"type":"text","text":" with **markdown**"}\n',
        gitDiff: null,
        testResults: null,
        failureReason: null,
      },
    ];
    const taskDetail = {
      id: "epic-1.1",
      title: "Implement feature",
      epicId: "epic-1",
      kanbanColumn: "done" as const,
      priority: 0,
      assignee: null,
      description: "",
      type: "task" as const,
      status: "closed" as const,
      labels: [] as string[],
      dependencies: [] as { targetId: string; type: string }[],
      createdAt: "",
      updatedAt: "",
    };
    const { TaskDetailSidebar } = await import("../components/execute/TaskDetailSidebar");
    const store = createStoreWithFilterMiddleware({
      tasks: [{ ...taskDetail, kanbanColumn: "done" }],
      selectedTaskId: "epic-1.1",
      isDoneTask: true,
      archivedSessions,
    });

    render(
      <Provider store={store}>
        <TaskDetailSidebar
          projectId="proj-1"
          selectedTask="epic-1.1"
          selectedTaskData={taskDetail}
          taskDetailLoading={false}
          taskDetailError={null}
          agentOutput={[]}
          completionState={null}
          archivedSessions={archivedSessions}
          archivedLoading={false}
          markDoneLoading={false}
          unblockLoading={false}
          taskIdToStartedAt={{}}
          plans={[basePlan]}
          tasks={[]}
          activeTasks={[]}
          wsConnected={false}
          isDoneTask={true}
          isBlockedTask={false}
          sourceFeedbackExpanded={{}}
          setSourceFeedbackExpanded={vi.fn()}
          descriptionSectionExpanded={true}
          setDescriptionSectionExpanded={vi.fn()}
          artifactsSectionExpanded={true}
          setArtifactsSectionExpanded={vi.fn()}
          onClose={vi.fn()}
          onMarkDone={vi.fn()}
          onUnblock={vi.fn()}
          onSelectTask={vi.fn()}
        />
      </Provider>
    );

    // ArchivedSessionView filters outputLog via filterAgentOutput
    expect(screen.getByText(/Visible output/)).toBeInTheDocument();
    expect(screen.getByText("markdown")).toBeInTheDocument();
    expect(screen.queryByText(/tool_use/)).not.toBeInTheDocument();
    expect(screen.queryByText('"type":"text"')).not.toBeInTheDocument();
  });

  it("archived output renders markdown elements (code block, list) when agent emitted markdown", async () => {
    const markdownText = "```\ncode block\n```\n\n- First\n- Second\n";
    const markdownOutput = JSON.stringify({ type: "text", text: markdownText }) + "\n";
    const archivedSessions = [
      {
        attempt: 1,
        status: "approved",
        agentType: "coder",
        outputLog: markdownOutput,
        gitDiff: null,
        testResults: null,
        failureReason: null,
      },
    ];
    const taskDetail = {
      id: "epic-1.1",
      title: "Implement feature",
      epicId: "epic-1",
      kanbanColumn: "done" as const,
      priority: 0,
      assignee: null,
      description: "",
      type: "task" as const,
      status: "closed" as const,
      labels: [] as string[],
      dependencies: [] as { targetId: string; type: string }[],
      createdAt: "",
      updatedAt: "",
    };
    const { TaskDetailSidebar } = await import("../components/execute/TaskDetailSidebar");
    const store = createStoreWithFilterMiddleware({
      tasks: [{ ...taskDetail, kanbanColumn: "done" }],
      selectedTaskId: "epic-1.1",
      isDoneTask: true,
      archivedSessions,
    });

    render(
      <Provider store={store}>
        <TaskDetailSidebar
          projectId="proj-1"
          selectedTask="epic-1.1"
          selectedTaskData={taskDetail}
          taskDetailLoading={false}
          taskDetailError={null}
          agentOutput={[]}
          completionState={null}
          archivedSessions={archivedSessions}
          archivedLoading={false}
          markDoneLoading={false}
          unblockLoading={false}
          taskIdToStartedAt={{}}
          plans={[basePlan]}
          tasks={[]}
          activeTasks={[]}
          wsConnected={false}
          isDoneTask={true}
          isBlockedTask={false}
          sourceFeedbackExpanded={{}}
          setSourceFeedbackExpanded={vi.fn()}
          descriptionSectionExpanded={true}
          setDescriptionSectionExpanded={vi.fn()}
          artifactsSectionExpanded={true}
          setArtifactsSectionExpanded={vi.fn()}
          onClose={vi.fn()}
          onMarkDone={vi.fn()}
          onUnblock={vi.fn()}
          onSelectTask={vi.fn()}
        />
      </Provider>
    );

    expect(screen.getByText("code block")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();

    const outputArea = document.querySelector(".prose-execute-task");
    expect(outputArea).toBeInTheDocument();
    expect(outputArea?.querySelector("pre")).toBeInTheDocument();
    expect(outputArea?.querySelector("code")).toBeInTheDocument();
    expect(outputArea?.querySelector("ul")).toBeInTheDocument();
    expect(outputArea?.querySelectorAll("li").length).toBeGreaterThanOrEqual(2);
  });

  it("plain text or non-JSON output passes through unchanged", async () => {
    const tasks = [
      {
        id: "epic-1.1",
        title: "Implement feature",
        epicId: "epic-1",
        kanbanColumn: "in_progress",
        priority: 0,
        assignee: "agent",
      },
    ];
    const store = createStoreWithFilterMiddleware({
      tasks,
      selectedTaskId: "epic-1.1",
      wsConnected: true,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Provider store={store}>
            <ExecutePhase projectId="proj-1" />
          </Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith("proj-1", "epic-1.1");
    });

    // Plain text (non-JSON) passes through
    await act(async () => {
      store.dispatch(
        appendAgentOutput({
          taskId: "epic-1.1",
          chunk: "Plain text output\nNo JSON here\n",
        })
      );
    });

    await waitFor(() => {
      const liveOutput = screen.getByTestId("live-agent-output");
      expect(liveOutput).toHaveTextContent("Plain text output");
    });
    const liveOutput = screen.getByTestId("live-agent-output");
    expect(liveOutput).toHaveTextContent("Plain text output");
    expect(liveOutput).toHaveTextContent("No JSON here");
  });
});
