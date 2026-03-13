import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";

function Thrower() {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the default fallback UI when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Thrower />
        </ErrorBoundary>
      </MemoryRouter>
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Something went wrong" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("uses aria-describedby for screen readers", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Thrower />
        </ErrorBoundary>
      </MemoryRouter>
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-describedby", "error-boundary-summary");
    expect(alert).toHaveAttribute("aria-labelledby", "error-boundary-heading");
  });

  it("renders a custom fallback when provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MemoryRouter>
        <ErrorBoundary fallback={<div>Custom fallback</div>}>
          <Thrower />
        </ErrorBoundary>
      </MemoryRouter>
    );

    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("has exactly one h1 per view and one primary action for scannable structure", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <MemoryRouter>
        <ErrorBoundary>
          <Thrower />
        </ErrorBoundary>
      </MemoryRouter>
    );
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Something went wrong");
    const buttons = screen.getAllByRole("button");
    const links = screen.queryAllByRole("link");
    expect(buttons.length + links.length).toBe(1);
  });

  it("reloads the page when the reload button is clicked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Thrower />
        </ErrorBoundary>
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalled();
  });
});
