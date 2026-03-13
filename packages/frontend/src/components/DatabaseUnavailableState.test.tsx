import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DatabaseUnavailableState } from "./DatabaseUnavailableState";

describe("DatabaseUnavailableState", () => {
  it("renders with one h1 heading and primary action", () => {
    render(
      <MemoryRouter>
        <DatabaseUnavailableState
          message="The database could not be reached."
          settingsHref="/settings"
        />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Database unavailable" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      "/settings"
    );
  });

  it("displays the message and uses aria-describedby for screen readers", () => {
    const message = "Connection refused. Check your database URL.";
    render(
      <MemoryRouter>
        <DatabaseUnavailableState message={message} settingsHref="/settings" />
      </MemoryRouter>
    );

    expect(screen.getByText(message, { exact: false })).toBeInTheDocument();
    const region = screen.getByTestId("database-unavailable-state");
    expect(region).toHaveAttribute("aria-describedby", "database-unavailable-summary");
    expect(region).toHaveAttribute("aria-labelledby", "database-unavailable-heading");
  });

  it("renders as region landmark with clear structure", () => {
    render(
      <MemoryRouter>
        <DatabaseUnavailableState message="Database is down." settingsHref="/projects/1/settings" />
      </MemoryRouter>
    );

    expect(
      screen.getByText(/Project phase content is unavailable until the database reconnects/)
    ).toBeInTheDocument();
    const region = screen.getByTestId("database-unavailable-state");
    expect(region).toHaveAttribute("role", "region");
  });

  it("has exactly one h1 per view for clear heading hierarchy", () => {
    const { container } = render(
      <MemoryRouter>
        <DatabaseUnavailableState message="DB down." settingsHref="/settings" />
      </MemoryRouter>
    );
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Database unavailable");
  });

  it("has exactly one primary action for scannable structure", () => {
    render(
      <MemoryRouter>
        <DatabaseUnavailableState message="DB down." settingsHref="/settings" />
      </MemoryRouter>
    );
    const links = screen.getAllByRole("link");
    const buttons = screen.queryAllByRole("button");
    expect(links.length + buttons.length).toBe(1);
  });
});
