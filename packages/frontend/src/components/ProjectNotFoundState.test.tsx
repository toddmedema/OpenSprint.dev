import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectNotFoundState } from "./ProjectNotFoundState";

describe("ProjectNotFoundState", () => {
  it("renders with one h1 heading and primary action", () => {
    render(
      <MemoryRouter>
        <ProjectNotFoundState />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Project not found" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to home" })).toHaveAttribute("href", "/");
  });

  it("uses aria-describedby for screen readers", () => {
    render(
      <MemoryRouter>
        <ProjectNotFoundState />
      </MemoryRouter>
    );

    const region = screen.getByTestId("project-not-found-state");
    expect(region).toHaveAttribute("aria-describedby", "project-not-found-summary");
    expect(region).toHaveAttribute("aria-labelledby", "project-not-found-heading");
  });

  it("renders as region landmark with clear structure", () => {
    render(
      <MemoryRouter>
        <ProjectNotFoundState />
      </MemoryRouter>
    );

    expect(screen.getByText(/Project not found or failed to load/)).toBeInTheDocument();
    const region = screen.getByTestId("project-not-found-state");
    expect(region).toHaveAttribute("role", "region");
  });

  it("has exactly one h1 per view for clear heading hierarchy", () => {
    const { container } = render(
      <MemoryRouter>
        <ProjectNotFoundState />
      </MemoryRouter>
    );
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Project not found");
  });

  it("has exactly one primary action for scannable structure", () => {
    render(
      <MemoryRouter>
        <ProjectNotFoundState />
      </MemoryRouter>
    );
    const links = screen.getAllByRole("link");
    const buttons = screen.queryAllByRole("button");
    expect(links.length + buttons.length).toBe(1);
  });
});
