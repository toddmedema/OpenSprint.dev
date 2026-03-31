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

vi.mock("../../api/client", () => ({
  api: {
    integrations: {
      todoist: {
        getStatus: (...args: unknown[]) => mockGetStatus(...args),
        startOAuth: (...args: unknown[]) => mockStartOAuth(...args),
        disconnect: (...args: unknown[]) => mockDisconnect(...args),
        listProjects: vi.fn().mockResolvedValue({ projects: [] }),
        selectProject: vi.fn().mockResolvedValue({ success: true }),
        syncNow: vi.fn().mockResolvedValue({ imported: 0, errors: 0 }),
      },
    },
  },
  isApiError: (err: unknown) =>
    err != null && typeof err === "object" && "name" in err && (err as { name: string }).name === "ApiError",
  ApiError: class ApiError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "ApiError";
      this.code = code;
    }
  },
}));

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

    expect(
      await screen.findByText("Failed to start OAuth. Please try again.")
    ).toBeInTheDocument();
  });

  // ---------- Not configured state ----------

  it("renders not-configured state when TODOIST_CLIENT_ID is missing", async () => {
    const { ApiError } = await import("../../api/client");
    mockGetStatus.mockRejectedValue(new ApiError("not configured", "INTEGRATION_NOT_CONFIGURED"));

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
    expect(screen.getByTestId("todoist-project-picker-placeholder")).toBeInTheDocument();
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
    expect(screen.queryByTestId("todoist-project-picker-placeholder")).not.toBeInTheDocument();
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
});
