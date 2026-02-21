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
  repoPath: "/path/to/repo",
  currentPhase: "sketch" as const,
  createdAt: "2026-02-15T12:00:00Z",
  updatedAt: "2026-02-15T12:00:00Z",
};

describe("HomeScreen", () => {
  it("shows loading state while fetching projects", async () => {
    mockProjectsList.mockImplementation(() => new Promise(() => {}));

    renderHomeScreen();

    expect(screen.getByText("Loading projects...")).toBeInTheDocument();
  });

  it("shows table with create row when no projects", async () => {
    mockProjectsList.mockResolvedValue([]);

    renderHomeScreen();

    await screen.findByTestId("projects-table");
    expect(screen.getByTestId("create-project-row")).toHaveTextContent("+ Create project");
  });

  it("renders project rows when projects exist", async () => {
    mockProjectsList.mockResolvedValue([mockProject]);

    renderHomeScreen();

    await screen.findByText("My Project");
    expect(screen.getByTestId("project-row-proj-1")).toBeInTheDocument();
    expect(screen.getByText("/path/to/repo")).toBeInTheDocument();
  });

  it("Create project row navigates to /projects/new", async () => {
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

    await screen.findByTestId("create-project-row");
    const createRow = screen.getByRole("button", { name: /\+ Create project/i });
    await user.click(createRow);

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/new");
  });

  it("clicking project row navigates to project sketch", async () => {
    mockProjectsList.mockResolvedValue([mockProject]);
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

    await screen.findByText("My Project");
    const row = screen.getByTestId("project-row-proj-1");
    await user.click(row);

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/proj-1/sketch");
  });

  it("table has Name and Folder path columns", async () => {
    mockProjectsList.mockResolvedValue([mockProject]);

    renderHomeScreen();

    await screen.findByText("My Project");
    expect(screen.getByRole("columnheader", { name: /name/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /folder path/i })).toBeInTheDocument();
  });
});
