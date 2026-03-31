import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TodoistIntegrationCard } from "./TodoistIntegrationCard";

const mockGetStatus = vi.fn();
const mockStartOAuth = vi.fn();
const mockDisconnect = vi.fn();
const mockListProjects = vi.fn();
const mockSelectProject = vi.fn();
const mockSyncNow = vi.fn();

vi.mock("../../api/client", () => {
  class ApiErrorImpl extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "ApiError";
      this.code = code;
    }
  }
  return {
    api: {
      integrations: {
        todoist: {
          getStatus: (...args: unknown[]) => mockGetStatus(...args),
          startOAuth: (...args: unknown[]) => mockStartOAuth(...args),
          disconnect: (...args: unknown[]) => mockDisconnect(...args),
          listProjects: (...args: unknown[]) => mockListProjects(...args),
          selectProject: (...args: unknown[]) => mockSelectProject(...args),
          syncNow: (...args: unknown[]) => mockSyncNow(...args),
        },
      },
    },
    isApiError: (err: unknown) =>
      err != null && typeof err === "object" && "name" in err && (err as { name: string }).name === "ApiError",
    ApiError: ApiErrorImpl,
  };
});

function createApiError(message: string, code: string): Error {
  const err = new Error(message);
  err.name = "ApiError";
  (err as Error & { code: string }).code = code;
  return err;
}

function renderCard(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("TodoistIntegrationCard", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockListProjects.mockResolvedValue({ projects: [] });
    mockSelectProject.mockResolvedValue({
      success: true,
      selectedProject: { id: "tp-1", name: "Project" },
    });
    mockSyncNow.mockResolvedValue({ imported: 0, errors: 0 });
    openSpy = vi.spyOn(window, "open").mockReturnValue({
      closed: false,
      close: vi.fn(),
    } as unknown as Window);
  });

  afterEach(() => {
    vi.useRealTimers();
    openSpy.mockRestore();
  });

  // ---------- Disconnected state ----------

  it("renders disconnected state with Connect button", async () => {
    mockGetStatus.mockResolvedValue({ connected: false, status: "disabled" });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("todoist-integration-card")).toBeInTheDocument();
    expect(screen.getByText("Todoist")).toBeInTheDocument();
    expect(
      screen.getByText("Import feedback from Todoist tasks into Evaluate")
    ).toBeInTheDocument();
    expect(screen.getByTestId("todoist-connect-btn")).toBeInTheDocument();
    expect(screen.getByTestId("todoist-connect-btn")).toHaveTextContent("Connect Todoist");
  });

  it("starts OAuth flow when Connect button is clicked", async () => {
    mockGetStatus.mockResolvedValue({ connected: false, status: "disabled" });
    mockStartOAuth.mockResolvedValue({
      authorizationUrl: "https://todoist.com/oauth/authorize?state=abc",
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const connectBtn = await screen.findByTestId("todoist-connect-btn");
    await user.click(connectBtn);

    await waitFor(() => {
      expect(mockStartOAuth).toHaveBeenCalledWith("proj-1");
    });

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "https://todoist.com/oauth/authorize?state=abc",
        "todoist-oauth",
        expect.any(String)
      );
    });
  });

  it("shows error message when OAuth start fails", async () => {
    mockGetStatus.mockResolvedValue({ connected: false, status: "disabled" });
    mockStartOAuth.mockRejectedValue(new Error("Network error"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const connectBtn = await screen.findByTestId("todoist-connect-btn");
    await user.click(connectBtn);

    expect(await screen.findByText("Failed to start OAuth. Please try again.")).toBeInTheDocument();
  });

  // ---------- Not configured state ----------

  it("renders not-configured state when TODOIST_CLIENT_ID is missing", async () => {
    mockGetStatus.mockRejectedValue(createApiError("not configured", "INTEGRATION_NOT_CONFIGURED"));

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("todoist-not-configured")).toBeInTheDocument();
    expect(screen.getByText(/TODOIST_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.getByText(/TODOIST_CLIENT_SECRET/)).toBeInTheDocument();
    expect(screen.queryByTestId("todoist-connect-btn")).not.toBeInTheDocument();
  });

  // ---------- Loading state ----------

  it("renders loading state initially", () => {
    mockGetStatus.mockReturnValue(new Promise(() => {})); // never resolves

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    expect(screen.getByText("Loading integration status…")).toBeInTheDocument();
  });

  // ---------- Connected state (no project selected) ----------

  it("renders connected state with email and no project", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const statusLine = await screen.findByTestId("todoist-status-line");
    expect(statusLine).toHaveTextContent("Connected to user@example.com");
    expect(screen.getByTestId("todoist-status-badge")).toHaveTextContent("Connected");
    expect(screen.getByTestId("todoist-project-picker")).toBeInTheDocument();
    expect(screen.getByTestId("todoist-disconnect-btn")).toBeInTheDocument();
  });

  it("shows user id when email is not available", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-42" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const statusLine = await screen.findByTestId("todoist-status-line");
    expect(statusLine).toHaveTextContent("Connected to user-42");
  });

  // ---------- Connected state (project selected) ----------

  it("renders full status with project and sync time", async () => {
    const syncTime = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Todoist Project" },
      lastSyncAt: syncTime,
      lastError: null,
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const statusLine = await screen.findByTestId("todoist-status-line");
    expect(statusLine).toHaveTextContent("Connected to dev@test.io");
    expect(statusLine).toHaveTextContent("Project: My Todoist Project");
    expect(statusLine).toHaveTextContent("Last sync: 2m ago");
    expect(screen.queryByTestId("todoist-project-picker")).not.toBeInTheDocument();
  });

  // ---------- Error banner ----------

  it("shows error banner when lastError is set", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: { id: "tp-1", name: "Project" },
      lastSyncAt: null,
      lastError: "Rate limit exceeded",
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const banner = await screen.findByTestId("todoist-error-banner");
    expect(banner).toHaveTextContent("Rate limit exceeded");
  });

  // ---------- Needs reconnect ----------

  it("shows reconnect banner when status is needs_reconnect", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "needs_reconnect",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: { id: "tp-1", name: "Project" },
      lastSyncAt: null,
      lastError: null,
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("todoist-reconnect-banner")).toBeInTheDocument();
    expect(screen.getByTestId("todoist-status-badge")).toHaveTextContent("Needs reconnect");
    expect(screen.getByTestId("todoist-reconnect-btn")).toBeInTheDocument();
  });

  it("reconnect button triggers OAuth flow", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "needs_reconnect",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockStartOAuth.mockResolvedValue({
      authorizationUrl: "https://todoist.com/oauth/authorize?state=xyz",
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const reconnectBtn = await screen.findByTestId("todoist-reconnect-btn");
    await user.click(reconnectBtn);

    await waitFor(() => {
      expect(mockStartOAuth).toHaveBeenCalledWith("proj-1");
    });
  });

  // ---------- Disconnect flow ----------

  it("shows confirmation dialog before disconnecting", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const disconnectBtn = await screen.findByTestId("todoist-disconnect-btn");
    await user.click(disconnectBtn);

    expect(screen.getByTestId("todoist-disconnect-confirm")).toBeInTheDocument();
    expect(screen.getByText(/revoke the Todoist token permanently/)).toBeInTheDocument();
  });

  it("cancels disconnect when cancel is clicked", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("todoist-disconnect-btn"));
    expect(screen.getByTestId("todoist-disconnect-confirm")).toBeInTheDocument();

    await user.click(screen.getByTestId("todoist-disconnect-cancel-btn"));
    expect(screen.queryByTestId("todoist-disconnect-confirm")).not.toBeInTheDocument();
  });

  it("calls disconnect API when confirmed", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockDisconnect.mockResolvedValue({ disconnected: true });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("todoist-disconnect-btn"));
    await user.click(screen.getByTestId("todoist-disconnect-confirm-btn"));

    await waitFor(() => {
      expect(mockDisconnect).toHaveBeenCalledWith("proj-1");
    });
  });

  it("shows pending deletes warning after disconnect", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockDisconnect.mockResolvedValue({ disconnected: true, pendingDeletesWarning: 5 });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("todoist-disconnect-btn"));
    await user.click(screen.getByTestId("todoist-disconnect-confirm-btn"));

    expect(await screen.findByTestId("todoist-pending-deletes-warning")).toBeInTheDocument();
    expect(screen.getByText(/5 imported task\(s\)/)).toBeInTheDocument();
  });

  // ---------- Generic error state ----------

  it("renders error state with retry button for non-config errors", async () => {
    mockGetStatus.mockRejectedValue(new Error("Server error"));

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    expect(
      await screen.findByText("Failed to load Todoist status. Please try again.")
    ).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("retries fetching status when retry is clicked", async () => {
    mockGetStatus.mockRejectedValueOnce(new Error("Server error"));
    mockGetStatus.mockResolvedValueOnce({ connected: false, status: "disabled" });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await screen.findByText("Retry");
    await user.click(screen.getByText("Retry"));

    expect(await screen.findByTestId("todoist-connect-btn")).toBeInTheDocument();
  });

  // ---------- Project picker (no project selected) ----------

  it("auto-opens project picker when connected with no project", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockResolvedValue({
      projects: [
        { id: "tp-1", name: "Inbox", taskCount: 5 },
        { id: "tp-2", name: "Work", taskCount: 12 },
      ],
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("todoist-project-picker")).toBeInTheDocument();
    expect(await screen.findByTestId("todoist-project-select")).toBeInTheDocument();
    expect(screen.getByText("Select a Todoist project")).toBeInTheDocument();
  });

  it("fetches and displays Todoist projects in dropdown", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockResolvedValue({
      projects: [
        { id: "tp-1", name: "Inbox", taskCount: 5 },
        { id: "tp-2", name: "Work", taskCount: 12 },
        { id: "tp-3", name: "Personal" },
      ],
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await waitFor(() => {
      expect(mockListProjects).toHaveBeenCalledWith("proj-1");
    });

    const select = await screen.findByTestId("todoist-project-select");
    expect(select).toBeInTheDocument();

    const options = select.querySelectorAll("option");
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveTextContent("Select a project…");
    expect(options[1]).toHaveTextContent("Inbox (5 tasks)");
    expect(options[2]).toHaveTextContent("Work (12 tasks)");
    expect(options[3]).toHaveTextContent("Personal");
  });

  it("shows loading state while fetching projects", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockReturnValue(new Promise(() => {}));

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("todoist-projects-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading projects…")).toBeInTheDocument();
  });

  it("shows error with retry when project fetch fails", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockRejectedValue(new Error("Network error"));

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    // Advance past react-query retry delay (retry: 1 with exponential backoff)
    await vi.advanceTimersByTimeAsync(3000);

    expect(await screen.findByTestId("todoist-projects-error")).toBeInTheDocument();
    expect(screen.getByText("Failed to load Todoist projects.")).toBeInTheDocument();
    expect(screen.getByTestId("todoist-projects-retry-btn")).toBeInTheDocument();
  });

  it("retries fetching projects when retry button is clicked", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockRejectedValue(new Error("Network error"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await vi.advanceTimersByTimeAsync(3000);

    await screen.findByTestId("todoist-projects-error");

    mockListProjects.mockResolvedValue({
      projects: [{ id: "tp-1", name: "Inbox" }],
    });
    await user.click(screen.getByTestId("todoist-projects-retry-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("todoist-project-select")).toBeInTheDocument();
    });
  });

  it("save button is disabled when no project is selected", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockResolvedValue({
      projects: [{ id: "tp-1", name: "Inbox" }],
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const saveBtn = await screen.findByTestId("todoist-save-project-btn");
    expect(saveBtn).toBeDisabled();
  });

  it("calls selectProject API when save is clicked with a project selected", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockResolvedValue({
      projects: [
        { id: "tp-1", name: "Inbox" },
        { id: "tp-2", name: "Work" },
      ],
    });
    mockSelectProject.mockResolvedValue({
      success: true,
      selectedProject: { id: "tp-2", name: "Work" },
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const select = await screen.findByTestId("todoist-project-select");
    await user.selectOptions(select, "tp-2");

    const saveBtn = screen.getByTestId("todoist-save-project-btn");
    expect(saveBtn).not.toBeDisabled();
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockSelectProject).toHaveBeenCalledWith("proj-1", { todoistProjectId: "tp-2" });
    });
  });

  it("shows save error when selectProject fails", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockResolvedValue({
      projects: [{ id: "tp-1", name: "Inbox" }],
    });
    mockSelectProject.mockRejectedValue(new Error("Server error"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const select = await screen.findByTestId("todoist-project-select");
    await user.selectOptions(select, "tp-1");

    await user.click(screen.getByTestId("todoist-save-project-btn"));

    expect(await screen.findByTestId("todoist-save-error")).toBeInTheDocument();
    expect(
      screen.getByText("Failed to save project selection. Please try again.")
    ).toBeInTheDocument();
  });

  // ---------- Project picker (project already selected) ----------

  it("shows project info with Change button when project is selected", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Project" },
      lastSyncAt: null,
      lastError: null,
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const info = await screen.findByTestId("todoist-project-info");
    expect(info).toBeInTheDocument();
    expect(info).toHaveTextContent("My Project");
    expect(info).toHaveTextContent("tp-1");
    expect(screen.getByTestId("todoist-change-project-btn")).toBeInTheDocument();
  });

  it("opens picker when Change button is clicked", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Project" },
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockResolvedValue({
      projects: [
        { id: "tp-1", name: "My Project" },
        { id: "tp-2", name: "Other" },
      ],
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await screen.findByTestId("todoist-project-info");
    await user.click(screen.getByTestId("todoist-change-project-btn"));

    expect(await screen.findByTestId("todoist-project-picker")).toBeInTheDocument();
    expect(screen.getByText("Change Todoist project")).toBeInTheDocument();
    expect(screen.getByTestId("todoist-cancel-picker-btn")).toBeInTheDocument();
  });

  it("closes picker when Cancel button is clicked", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Project" },
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockResolvedValue({
      projects: [{ id: "tp-1", name: "My Project" }],
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await screen.findByTestId("todoist-project-info");
    await user.click(screen.getByTestId("todoist-change-project-btn"));

    expect(await screen.findByTestId("todoist-project-picker")).toBeInTheDocument();
    await user.click(screen.getByTestId("todoist-cancel-picker-btn"));

    expect(await screen.findByTestId("todoist-project-info")).toBeInTheDocument();
    expect(screen.queryByTestId("todoist-project-picker")).not.toBeInTheDocument();
  });

  // ---------- Import existing tasks toggle ----------

  it("renders import existing tasks checkbox", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockResolvedValue({
      projects: [{ id: "tp-1", name: "Inbox" }],
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("todoist-import-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("todoist-import-checkbox")).not.toBeChecked();
    expect(screen.getByText("Import existing open tasks (one-time)")).toBeInTheDocument();
  });

  it("toggles import existing tasks checkbox", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListProjects.mockResolvedValue({
      projects: [{ id: "tp-1", name: "Inbox" }],
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const checkbox = await screen.findByTestId("todoist-import-checkbox");
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  // ---------- Sync Now button ----------

  it("shows Sync Now button when project is selected", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Project" },
      lastSyncAt: null,
      lastError: null,
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("todoist-sync-now-btn")).toBeInTheDocument();
    expect(screen.getByTestId("todoist-sync-now-btn")).toHaveTextContent("Sync Now");
  });

  it("does not show Sync Now when no project is selected", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: null,
      lastSyncAt: null,
      lastError: null,
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await screen.findByTestId("todoist-integration-card");
    expect(screen.queryByTestId("todoist-sync-now-btn")).not.toBeInTheDocument();
  });

  it("calls syncNow and shows success message with item count", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Project" },
      lastSyncAt: null,
      lastError: null,
    });
    mockSyncNow.mockResolvedValue({ imported: 3, errors: 0 });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const syncBtn = await screen.findByTestId("todoist-sync-now-btn");
    await user.click(syncBtn);

    await waitFor(() => {
      expect(mockSyncNow).toHaveBeenCalledWith("proj-1");
    });

    expect(await screen.findByTestId("todoist-sync-message")).toHaveTextContent("3 items imported");
  });

  it("shows singular 'item' when exactly 1 imported", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Project" },
      lastSyncAt: null,
      lastError: null,
    });
    mockSyncNow.mockResolvedValue({ imported: 1, errors: 0 });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("todoist-sync-now-btn"));

    expect(await screen.findByTestId("todoist-sync-message")).toHaveTextContent("1 item imported");
  });

  it("shows loading spinner while syncing", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Project" },
      lastSyncAt: null,
      lastError: null,
    });
    mockSyncNow.mockReturnValue(new Promise(() => {}));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("todoist-sync-now-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("todoist-sync-spinner")).toBeInTheDocument();
    });
    expect(screen.getByTestId("todoist-sync-now-btn")).toHaveTextContent("Syncing…");
    expect(screen.getByTestId("todoist-sync-now-btn")).toBeDisabled();
  });

  it("shows rate limit message on 429 (SYNC_RATE_LIMITED)", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Project" },
      lastSyncAt: null,
      lastError: null,
    });
    mockSyncNow.mockRejectedValue(createApiError("Rate limited", "SYNC_RATE_LIMITED"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("todoist-sync-now-btn"));

    expect(await screen.findByTestId("todoist-sync-message")).toHaveTextContent(
      "Please wait before syncing again"
    );
  });

  it("shows rate limit message on RATE_LIMITED code", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Project" },
      lastSyncAt: null,
      lastError: null,
    });
    mockSyncNow.mockRejectedValue(createApiError("Rate limited", "RATE_LIMITED"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("todoist-sync-now-btn"));

    expect(await screen.findByTestId("todoist-sync-message")).toHaveTextContent(
      "Please wait before syncing again"
    );
  });

  it("shows generic error message on sync failure", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Project" },
      lastSyncAt: null,
      lastError: null,
    });
    mockSyncNow.mockRejectedValue(new Error("Network error"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("todoist-sync-now-btn"));

    expect(await screen.findByTestId("todoist-sync-message")).toHaveTextContent("Network error");
  });

  // ---------- Dismissible error banner ----------

  it("shows dismissible error banner with suggestion text", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: { id: "tp-1", name: "Project" },
      lastSyncAt: null,
      lastError: "Rate limit exceeded",
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    const banner = await screen.findByTestId("todoist-error-banner");
    expect(banner).toHaveTextContent("Rate limit exceeded");
    expect(banner).toHaveTextContent("Check your Todoist connection or try syncing again.");
    expect(screen.getByTestId("todoist-error-dismiss-btn")).toBeInTheDocument();
  });

  it("dismisses error banner when dismiss button is clicked", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "user@example.com" },
      selectedProject: { id: "tp-1", name: "Project" },
      lastSyncAt: null,
      lastError: "Something went wrong",
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("todoist-error-banner")).toBeInTheDocument();

    await user.click(screen.getByTestId("todoist-error-dismiss-btn"));

    expect(screen.queryByTestId("todoist-error-banner")).not.toBeInTheDocument();
  });

  // ---------- Helper text (permanent deletion warning) ----------

  it("shows permanent deletion warning when project is selected", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      status: "active",
      todoistUser: { id: "user-1", email: "dev@test.io" },
      selectedProject: { id: "tp-1", name: "My Project" },
      lastSyncAt: null,
      lastError: null,
    });

    renderCard(<TodoistIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("todoist-delete-warning")).toHaveTextContent(
      "Tasks will be permanently deleted from Todoist after successful import."
    );
  });
});
