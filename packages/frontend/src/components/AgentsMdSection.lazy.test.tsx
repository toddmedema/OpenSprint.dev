import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockGetAgentsInstructions = vi.fn();
const mockUpdateAgentsInstructions = vi.fn();

const mockGetAgentsInstructionsForRole = vi.fn();
const mockUpdateAgentsInstructionsForRole = vi.fn();
let resolveEditorImport: (() => void) | null = null;

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

vi.mock("./AgentsMdEditor", () => {
  const MockAgentsMdEditor = ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
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
  return new Promise<{ AgentsMdEditor: typeof MockAgentsMdEditor }>((resolve) => {
    resolveEditorImport = () => resolve({ AgentsMdEditor: MockAgentsMdEditor });
  });
});

describe("AgentsMdSection lazy-loading", () => {
  const projectId = "proj-1";

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resolveEditorImport = null;
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
    let result: ReturnType<typeof render> | undefined;

    await act(async () => {
      result = render(
        <ThemeProvider>
          <AgentsMdSection projectId={projectId} />
        </ThemeProvider>
      );
      await Promise.resolve();
    });

    return result!;
  }

  it("shows Loading editor... while the editor chunk is loading", async () => {
    const user = userEvent.setup();
    await renderSection();

    await screen.findByTestId("agents-md-view");
    await user.click(screen.getByTestId("agents-md-edit"));

    expect(resolveEditorImport).not.toBeNull();
    expect(await screen.findByTestId("agents-md-editor-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading editor...")).toBeInTheDocument();

    await act(async () => {
      resolveEditorImport?.();
      await Promise.resolve();
    });
    await screen.findByTestId("mock-md-editor");
  });

  it("shows editor after lazy load completes", async () => {
    const user = userEvent.setup();
    await renderSection();

    await screen.findByTestId("agents-md-view");
    await user.click(screen.getByTestId("agents-md-edit"));

    if (resolveEditorImport) {
      await act(async () => {
        resolveEditorImport?.();
        await Promise.resolve();
      });
    }

    expect(await screen.findByTestId("mock-md-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bold/i })).toBeInTheDocument();
  });
});
