import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GitHubIntegrationCard } from "./GitHubIntegrationCard";

const mockGetStatus = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockListRepos = vi.fn();
const mockSelectRepo = vi.fn();
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
        github: {
          getStatus: (...args: unknown[]) => mockGetStatus(...args),
          connect: (...args: unknown[]) => mockConnect(...args),
          disconnect: (...args: unknown[]) => mockDisconnect(...args),
          listRepos: (...args: unknown[]) => mockListRepos(...args),
          selectRepo: (...args: unknown[]) => mockSelectRepo(...args),
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

describe("GitHubIntegrationCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockListRepos.mockResolvedValue({ repos: [] });
    mockSelectRepo.mockResolvedValue({
      success: true,
      selectedSource: { id: "123", name: "octocat/hello-world" },
    });
    mockSyncNow.mockResolvedValue({ imported: 0, errors: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------- Disconnected state ----------

  it("renders disconnected state with Connect button", async () => {
    mockGetStatus.mockResolvedValue({ connected: false, provider: "github", status: "disabled" });

    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("github-integration-card")).toBeInTheDocument();
    expect(screen.getByText("GitHub Issues")).toBeInTheDocument();
    expect(screen.getByTestId("github-connect-btn")).toHaveTextContent("Connect");
  });

  it("shows PAT input form when Connect is clicked", async () => {
    mockGetStatus.mockResolvedValue({ connected: false, provider: "github", status: "disabled" });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("github-connect-btn"));

    expect(screen.getByTestId("github-token-form")).toBeInTheDocument();
    expect(screen.getByTestId("github-pat-input")).toBeInTheDocument();
    expect(screen.getByText(/fine-grained PAT/)).toBeInTheDocument();
    expect(screen.getByText(/stored locally and encrypted/)).toBeInTheDocument();
  });

  it("connects successfully with a valid token", async () => {
    mockGetStatus.mockResolvedValue({ connected: false, provider: "github", status: "disabled" });
    mockConnect.mockResolvedValue({ success: true, user: "octocat" });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("github-connect-btn"));
    await user.type(screen.getByTestId("github-pat-input"), "ghp_valid123");
    await user.click(screen.getByTestId("github-save-token-btn"));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith("proj-1", { token: "ghp_valid123" });
    });
  });

  it("shows error when token is invalid", async () => {
    mockGetStatus.mockResolvedValue({ connected: false, provider: "github", status: "disabled" });
    mockConnect.mockRejectedValue(createApiError("Bad token", "INVALID_TOKEN"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("github-connect-btn"));
    await user.type(screen.getByTestId("github-pat-input"), "ghp_invalid");
    await user.click(screen.getByTestId("github-save-token-btn"));

    expect(await screen.findByTestId("github-connect-error")).toHaveTextContent(
      "Invalid token"
    );
  });

  // ---------- Connected state ----------

  it("renders connected status with user name", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      provider: "github",
      status: "active",
      user: { id: "octocat" },
      selectedSource: { id: "123", name: "octocat/hello-world" },
      lastSyncAt: null,
      lastError: null,
    });

    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    const statusLine = await screen.findByTestId("github-status-line");
    expect(statusLine).toHaveTextContent("Connected as octocat");
    expect(statusLine).toHaveTextContent("Repo: octocat/hello-world");
    expect(screen.getByTestId("github-status-badge")).toHaveTextContent("Connected");
  });

  // ---------- Repo picker ----------

  it("auto-opens repo picker when connected with no repo", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      provider: "github",
      status: "active",
      user: { id: "octocat" },
      selectedSource: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListRepos.mockResolvedValue({
      repos: [
        { id: "1", name: "octocat/hello-world", itemCount: 5 },
        { id: "2", name: "octocat/spoon-knife", itemCount: 0 },
      ],
    });

    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("github-repo-picker")).toBeInTheDocument();
    const select = await screen.findByTestId("github-repo-select");
    const options = select.querySelectorAll("option");
    expect(options).toHaveLength(3);
    expect(options[1]).toHaveTextContent("octocat/hello-world (5 open issues)");
  });

  it("saves selected repo", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      provider: "github",
      status: "active",
      user: { id: "octocat" },
      selectedSource: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockListRepos.mockResolvedValue({
      repos: [
        { id: "1", name: "octocat/hello-world", itemCount: 5 },
      ],
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    const select = await screen.findByTestId("github-repo-select");
    await user.selectOptions(select, "1");
    await user.click(screen.getByTestId("github-save-repo-btn"));

    await waitFor(() => {
      expect(mockSelectRepo).toHaveBeenCalledWith("proj-1", {
        repoId: "1",
        repoFullName: "octocat/hello-world",
      });
    });
  });

  // ---------- Sync ----------

  it("calls sync and shows success message", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      provider: "github",
      status: "active",
      user: { id: "octocat" },
      selectedSource: { id: "1", name: "octocat/hello-world" },
      lastSyncAt: null,
      lastError: null,
    });
    mockSyncNow.mockResolvedValue({ imported: 3, errors: 0 });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("github-sync-now-btn"));

    await waitFor(() => {
      expect(mockSyncNow).toHaveBeenCalledWith("proj-1");
    });

    expect(await screen.findByTestId("github-sync-message")).toHaveTextContent("3 issues imported");
  });

  it("shows rate limit message on SYNC_RATE_LIMITED", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      provider: "github",
      status: "active",
      user: { id: "octocat" },
      selectedSource: { id: "1", name: "octocat/hello-world" },
      lastSyncAt: null,
      lastError: null,
    });
    mockSyncNow.mockRejectedValue(createApiError("Rate limited", "SYNC_RATE_LIMITED"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("github-sync-now-btn"));

    expect(await screen.findByTestId("github-sync-message")).toHaveTextContent(
      "Please wait before syncing again"
    );
  });

  // ---------- Disconnect ----------

  it("shows confirmation before disconnect", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      provider: "github",
      status: "active",
      user: { id: "octocat" },
      selectedSource: null,
      lastSyncAt: null,
      lastError: null,
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("github-disconnect-btn"));

    expect(screen.getByTestId("github-disconnect-confirm")).toBeInTheDocument();
    expect(screen.getByText(/remove your stored GitHub token/)).toBeInTheDocument();
  });

  it("disconnects when confirmed", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      provider: "github",
      status: "active",
      user: { id: "octocat" },
      selectedSource: null,
      lastSyncAt: null,
      lastError: null,
    });
    mockDisconnect.mockResolvedValue({ disconnected: true });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    await user.click(await screen.findByTestId("github-disconnect-btn"));
    await user.click(screen.getByTestId("github-disconnect-confirm-btn"));

    await waitFor(() => {
      expect(mockDisconnect).toHaveBeenCalledWith("proj-1");
    });
  });

  // ---------- Needs reconnect ----------

  it("shows reconnect banner when status is needs_reconnect", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      provider: "github",
      status: "needs_reconnect",
      user: { id: "octocat" },
      selectedSource: { id: "1", name: "octocat/hello-world" },
      lastSyncAt: null,
      lastError: null,
    });

    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    expect(await screen.findByTestId("github-reconnect-banner")).toBeInTheDocument();
    expect(screen.getByTestId("github-status-badge")).toHaveTextContent("Needs Reconnect");
  });

  // ---------- Error banner ----------

  it("shows error banner when lastError is set", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      provider: "github",
      status: "active",
      user: { id: "octocat" },
      selectedSource: { id: "1", name: "octocat/hello-world" },
      lastSyncAt: null,
      lastError: "API rate limit exceeded",
    });

    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    const banner = await screen.findByTestId("github-error-banner");
    expect(banner).toHaveTextContent("API rate limit exceeded");
  });

  // ---------- Error state ----------

  it("renders error state with retry button", async () => {
    mockGetStatus.mockRejectedValue(new Error("Server error"));

    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    expect(
      await screen.findByText("Failed to load GitHub status. Please try again.")
    ).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  // ---------- Loading state ----------

  it("renders loading state initially", () => {
    mockGetStatus.mockReturnValue(new Promise(() => {}));

    renderCard(<GitHubIntegrationCard projectId="proj-1" />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
