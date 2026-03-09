import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ElectronShortcuts } from "./ElectronShortcuts";

function LocationDisplay() {
  const loc = useLocation();
  return <span data-testid="location">{loc.pathname}</span>;
}

function dispatchKeydown(key: string, options?: { code?: string; metaKey?: boolean }) {
  const ev = new KeyboardEvent("keydown", {
    key,
    code: options?.code ?? `Digit${key}`,
    metaKey: options?.metaKey ?? false,
    ctrlKey: false,
    altKey: false,
    bubbles: true,
  });
  document.dispatchEvent(ev);
  return ev;
}

describe("ElectronShortcuts", () => {
  const originalElectron = (window as unknown as { electron?: unknown }).electron;

  beforeEach(() => {
    (window as unknown as { electron?: { isElectron: boolean } }).electron = { isElectron: true };
  });

  afterEach(() => {
    (window as unknown as { electron?: unknown }).electron = originalElectron;
  });

  it("does nothing when not in Electron", async () => {
    (window as unknown as { electron?: { isElectron: boolean } }).electron = { isElectron: false };
    render(
      <MemoryRouter initialEntries={["/projects/p1/sketch"]}>
        <ElectronShortcuts />
        <Routes>
          <Route path="/projects/:projectId/:phase" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1/sketch");
    dispatchKeydown("2");
    await waitFor(() => {}, { timeout: 100 });
    expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1/sketch");
  });

  it("1–5 switch to Sketch/Plan/Execute/Evaluate/Deliver when on a project", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/p1/sketch"]}>
        <ElectronShortcuts />
        <Routes>
          <Route path="/projects/:projectId/:phase" element={<LocationDisplay />} />
          <Route path="/" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1/sketch");

    await act(() => {
      dispatchKeydown("2");
    });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1/plan");
    });

    await act(() => {
      dispatchKeydown("3");
    });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1/execute");
    });

    await act(() => {
      dispatchKeydown("4");
    });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1/eval");
    });

    await act(() => {
      dispatchKeydown("5");
    });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1/deliver");
    });

    await act(() => {
      dispatchKeydown("1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1/sketch");
    });
  });

  it("~ (backquote) navigates to home", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/p1/sketch"]}>
        <ElectronShortcuts />
        <Routes>
          <Route path="/projects/:projectId/:phase" element={<LocationDisplay />} />
          <Route path="/" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    );

    await act(() => {
      dispatchKeydown("`");
    });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/");
    });
  });

  it("phase shortcuts require no modifier (Cmd+1 does not navigate)", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/p1/sketch"]}>
        <ElectronShortcuts />
        <Routes>
          <Route path="/projects/:projectId/:phase" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    );

    await act(() => {
      dispatchKeydown("2", { metaKey: true });
    });
    await waitFor(() => {}, { timeout: 100 });
    expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1/sketch");
  });
});
