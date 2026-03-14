import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockGetAgentsInstructions = vi.fn();
const mockUpdateAgentsInstructions = vi.fn();

const mockGetAgentsInstructionsForRole = vi.fn();
const mockUpdateAgentsInstructionsForRole = vi.fn();
let resolveMDEditorImport: (() => void) | null = null;

vi.mock("../api/client", () => ({
  api: {
    projects: {
      getAgentsInstructions: (...args: unknown[]) => mockGetAgentsInstructions(...args),
      updateAgentsInstructions: (...args: unknown[]) => mockUpdateAgentsInstructions(...args),
      getAgentsInstructionsForRole: (...args: unknown[]) =>
        mockGetAgentsInstructionsForRole(...args),
      updateAgentsInstructionsForRole: (...args: unknown[]) =>
        mockUpdateAgentsInstructionsForRole(...args),
    },
  },
}));

vi.mock("@uiw/react-md-editor", () => {
  const MockMDEditor = ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string | undefined) => void;
  }) => (
    <div data-testid="mock-md-editor">
      <button type="button" aria-label="Bold">
        Bold
      </button>
      <textarea
        data-testid="mock-md-editor-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
  return new Promise<{ default: typeof MockMDEditor }>((resolve) => {
    resolveMDEditorImport = () => resolve({ default: MockMDEditor });
  });
});

describe("AgentsMdSection lazy-loading", () => {
  const projectId = "proj-1";

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resolveMDEditorImport = null;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    mockGetAgentsInstructions.mockResolvedValue({
      content: "# Agent Instructions\n\nUse bd for tasks.",
    });
    mockUpdateAgentsInstructions.mockResolvedValue({ saved: true });
  });

  async function renderSection() {
    const [{ ThemeProvider }, { AgentsMdSection }] = await Promise.all([
      import("../contexts/ThemeContext"),
      import("./AgentsMdSection"),
    ]);

    return render(
      <ThemeProvider>
        <AgentsMdSection projectId={projectId} />
      </ThemeProvider>
    );
  }

  it("shows Loading editor... while MDEditor chunk is loading", async () => {
    const user = userEvent.setup();
    await renderSection();

    await screen.findByTestId("agents-md-view");
    await user.click(screen.getByTestId("agents-md-edit"));

    expect(resolveMDEditorImport).not.toBeNull();
    expect(await screen.findByTestId("agents-md-editor-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading editor...")).toBeInTheDocument();

    await act(async () => {
      resolveMDEditorImport?.();
      await Promise.resolve();
    });
    await screen.findByTestId("mock-md-editor");
  });

  it("shows editor after lazy load completes", async () => {
    const user = userEvent.setup();
    await renderSection();

    await screen.findByTestId("agents-md-view");
    await user.click(screen.getByTestId("agents-md-edit"));

    if (resolveMDEditorImport) {
      await act(async () => {
        resolveMDEditorImport?.();
        await Promise.resolve();
      });
    }

    expect(await screen.findByTestId("mock-md-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bold/i })).toBeInTheDocument();
  });
});
