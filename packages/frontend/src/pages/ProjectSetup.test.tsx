import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ProjectSetup } from "./ProjectSetup";

// Mock the API and Layout to avoid network calls and complex layout
vi.mock("../api/client", () => ({
  api: {
    projects: { create: vi.fn() },
    env: { getKeys: vi.fn().mockResolvedValue({ anthropic: true, cursor: true, claudeCli: true }) },
    filesystem: { detectTestFramework: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("../components/layout/Layout", () => ({
  Layout: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

vi.mock("../components/FolderBrowser", () => ({
  FolderBrowser: () => null,
}));

vi.mock("../components/ModelSelect", () => ({
  ModelSelect: () => <select data-testid="model-select" />,
}));

function renderProjectSetup() {
  return render(
    <MemoryRouter>
      <ProjectSetup />
    </MemoryRouter>
  );
}

describe("ProjectSetup - Step 1 validation", () => {
  it("shows project info step (name and repository) on first load", () => {
    renderProjectSetup();

    expect(screen.getByTestId("project-metadata-step")).toBeInTheDocument();
    expect(screen.getByLabelText(/project name/i)).toBeInTheDocument();
    expect(screen.getByTestId("repository-step")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("/Users/you/projects/my-app")).toBeInTheDocument();
  });

  it("disables Next when repo path is empty", () => {
    renderProjectSetup();

    const nextButton = screen.getByRole("button", { name: /next/i });
    expect(nextButton).toBeDisabled();
  });

  it("blocks Next when name is empty and shows error on click", async () => {
    const user = userEvent.setup();
    renderProjectSetup();

    await user.type(screen.getByPlaceholderText("/Users/you/projects/my-app"), "/path/to/repo");
    const nextButton = screen.getByRole("button", { name: /next/i });
    expect(nextButton).toBeEnabled();

    await user.click(nextButton);

    expect(screen.getByRole("alert")).toHaveTextContent(/project name is required/i);
    expect(screen.getByTestId("project-metadata-step")).toBeInTheDocument();
  });

  it("advances to agent config when name and repo path are filled", async () => {
    const user = userEvent.setup();
    renderProjectSetup();

    await user.type(screen.getByLabelText(/project name/i), "My Project");
    await user.type(screen.getByPlaceholderText("/Users/you/projects/my-app"), "/path/to/repo");
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.queryByTestId("project-metadata-step")).not.toBeInTheDocument();
    expect(screen.queryByTestId("repository-step")).not.toBeInTheDocument();
    expect(screen.getByTestId("agents-step")).toBeInTheDocument();
  });
});

describe("ProjectSetup - Navigation step list overflow handling", () => {
  it("renders step list inside a nav element with overflow-x-auto", () => {
    renderProjectSetup();

    const nav = screen.getByRole("navigation", { name: /setup wizard steps/i });
    expect(nav).toBeInTheDocument();
    expect(nav.className).toContain("overflow-x-auto");
  });

  it("uses a semantic ordered list for steps", () => {
    renderProjectSetup();

    const nav = screen.getByRole("navigation", { name: /setup wizard steps/i });
    const list = within(nav).getByRole("list");
    expect(list).toBeInTheDocument();
    expect(list.tagName).toBe("OL");
  });

  it("renders all 6 wizard steps as list items", () => {
    renderProjectSetup();

    const nav = screen.getByRole("navigation", { name: /setup wizard steps/i });
    const items = within(nav).getAllByRole("listitem");
    expect(items).toHaveLength(6);
  });

  it("displays correct step labels in order", () => {
    renderProjectSetup();

    const expectedLabels = [
      "Project Info",
      "Agent Config",
      "Deliver",
      "Testing",
      "Autonomy",
      "Confirm",
    ];

    const nav = screen.getByRole("navigation", { name: /setup wizard steps/i });
    const items = within(nav).getAllByRole("listitem");

    items.forEach((item, i) => {
      expect(item).toHaveTextContent(expectedLabels[i]);
    });
  });

  it("applies shrink-0 to list items to prevent flex collapse", () => {
    renderProjectSetup();

    const nav = screen.getByRole("navigation", { name: /setup wizard steps/i });
    const items = within(nav).getAllByRole("listitem");

    items.forEach((item) => {
      expect(item.className).toContain("shrink-0");
    });
  });

  it("applies whitespace-nowrap to step labels", () => {
    renderProjectSetup();

    const nav = screen.getByRole("navigation", { name: /setup wizard steps/i });
    const items = within(nav).getAllByRole("listitem");

    items.forEach((item) => {
      const label = item.querySelector("span");
      expect(label).not.toBeNull();
      expect(label!.className).toContain("whitespace-nowrap");
    });
  });

  it("highlights the current step and previous steps", () => {
    renderProjectSetup();

    const nav = screen.getByRole("navigation", { name: /setup wizard steps/i });
    const items = within(nav).getAllByRole("listitem");

    const firstCircle = items[0].querySelector("div");
    expect(firstCircle!.className).toContain("bg-brand-600");

    const lastCircle = items[5].querySelector("div");
    expect(lastCircle!.className).toContain("bg-theme-surface-muted");
  });

  it("renders step numbers 1 through 6", () => {
    renderProjectSetup();

    const nav = screen.getByRole("navigation", { name: /setup wizard steps/i });

    for (let i = 1; i <= 6; i++) {
      expect(within(nav).getByText(String(i))).toBeInTheDocument();
    }
  });

  it("renders connector lines between steps (5 connectors for 6 steps)", () => {
    renderProjectSetup();

    const nav = screen.getByRole("navigation", { name: /setup wizard steps/i });
    const connectors = nav.querySelectorAll(".w-8.h-0\\.5");
    expect(connectors).toHaveLength(5);
  });

  it("inner list has min-w-0 to enable flex overflow", () => {
    renderProjectSetup();

    const nav = screen.getByRole("navigation", { name: /setup wizard steps/i });
    const list = within(nav).getByRole("list");
    expect(list.className).toContain("min-w-0");
  });
});
