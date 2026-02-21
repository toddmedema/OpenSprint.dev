import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { HomeScreen } from "./HomeScreen";

const mockProjectsList = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    projects: { list: (...args: unknown[]) => mockProjectsList(...args) },
  },
}));

vi.mock("./layout/Layout", () => ({
  Layout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

function renderHomeScreen() {
  return render(
    <MemoryRouter>
      <HomeScreen />
    </MemoryRouter>
  );
}

const mockProject = {
  id: "proj-1",
  name: "My Project",
  currentPhase: "sketch",
  progressPercent: 25,
  updatedAt: "2026-02-15T12:00:00Z",
};

describe("HomeScreen", () => {
  it("shows loading state while fetching projects", async () => {
    mockProjectsList.mockImplementation(() => new Promise(() => {}));

    renderHomeScreen();

    expect(screen.getByText("Loading projects...")).toBeInTheDocument();
  });

  it("shows empty state when no projects", async () => {
    mockProjectsList.mockResolvedValue([]);

    renderHomeScreen();

    await screen.findByText("No projects yet");
    expect(screen.getByText("Get started by creating your first project")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create new project/i })).toBeInTheDocument();
  });

  it("renders project cards when projects exist", async () => {
    mockProjectsList.mockResolvedValue([mockProject]);

    renderHomeScreen();

    await screen.findByText("My Project");
    expect(screen.getByText("sketch")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("Create New Project button navigates to /projects/new", async () => {
    mockProjectsList.mockResolvedValue([]);
    const user = userEvent.setup();

    function LocationDisplay() {
      return <div data-testid="location">{useLocation().pathname}</div>;
    }

    render(
      <MemoryRouter>
        <HomeScreen />
        <LocationDisplay />
      </MemoryRouter>
    );

    await screen.findByText("No projects yet");
    const createButton = screen.getByRole("button", { name: /create new project/i });
    await user.click(createButton);

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/new");
  });

  it("project grid has improved spacing (gap-8 lg:gap-12)", async () => {
    mockProjectsList.mockResolvedValue([mockProject]);

    renderHomeScreen();

    await screen.findByText("My Project");
    const grid = screen.getByText("My Project").closest(".grid");
    expect(grid).toHaveClass("gap-8");
    expect(grid).toHaveClass("lg:gap-12");
  });

  it("project cards have increased padding (p-8)", async () => {
    mockProjectsList.mockResolvedValue([mockProject]);

    renderHomeScreen();

    await screen.findByText("My Project");
    const card = screen.getByRole("link", { name: /my project/i });
    expect(card).toHaveClass("p-8");
  });

  it("project cards have uniform height classes (h-full min-h)", async () => {
    mockProjectsList.mockResolvedValue([mockProject]);

    renderHomeScreen();

    await screen.findByText("My Project");
    const card = screen.getByRole("link", { name: /my project/i });
    expect(card).toHaveClass("h-full");
    expect(card).toHaveClass("min-h-[12rem]");
  });

  it("cards with short and long names render in same-height grid", async () => {
    const shortName = { ...mockProject, id: "p1", name: "A" };
    const longName = {
      ...mockProject,
      id: "p2",
      name: "A Very Long Project Name That Wraps To Multiple Lines",
    };
    mockProjectsList.mockResolvedValue([shortName, longName]);

    renderHomeScreen();

    await screen.findByText("A");
    await screen.findByText("A Very Long Project Name That Wraps To Multiple Lines");
    const grid = screen.getByText("A").closest(".grid");
    expect(grid).toBeInTheDocument();
    const cards = grid!.querySelectorAll("a[href*='/projects/']");
    expect(cards.length).toBe(2);
    cards.forEach((card) => {
      expect(card).toHaveClass("h-full");
      expect(card).toHaveClass("min-h-[12rem]");
    });
  });

  it("project card links to correct phase path", async () => {
    mockProjectsList.mockResolvedValue([mockProject]);

    renderHomeScreen();

    await screen.findByText("My Project");
    const link = screen.getByRole("link", { name: /my project/i });
    expect(link).toHaveAttribute("href", "/projects/proj-1/sketch");
  });
});
