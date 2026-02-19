import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ProjectMetadataStep, isValidProjectMetadata } from "./ProjectMetadataStep";

describe("ProjectMetadataStep", () => {
  it("renders project name input", () => {
    render(
      <ProjectMetadataStep
        value={{ name: "" }}
        onChange={() => {}}
      />
    );

    expect(screen.getByLabelText(/project name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("My Awesome App")).toBeInTheDocument();
  });

  it("displays current values", () => {
    render(
      <ProjectMetadataStep
        value={{ name: "My App" }}
        onChange={() => {}}
      />
    );

    expect(screen.getByDisplayValue("My App")).toBeInTheDocument();
  });

  it("calls onChange when inputs change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function Harness() {
      const [value, setValue] = useState({ name: "" });
      return (
        <ProjectMetadataStep
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Harness />);

    await user.type(screen.getByLabelText(/project name/i), "Test");
    expect(onChange).toHaveBeenCalled();
    const lastNameCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastNameCall.name).toBe("Test");
  });

  it("displays validation error when provided", () => {
    render(
      <ProjectMetadataStep
        value={{ name: "" }}
        onChange={() => {}}
        error="Project name is required"
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Project name is required");
  });

  it("has data-testid for integration tests", () => {
    render(
      <ProjectMetadataStep
        value={{ name: "" }}
        onChange={() => {}}
      />
    );

    expect(screen.getByTestId("project-metadata-step")).toBeInTheDocument();
  });
});

describe("isValidProjectMetadata", () => {
  it("returns false for empty name", () => {
    expect(isValidProjectMetadata({ name: "" })).toBe(false);
    expect(isValidProjectMetadata({ name: "   " })).toBe(false);
  });

  it("returns true for non-empty trimmed name", () => {
    expect(isValidProjectMetadata({ name: "a" })).toBe(true);
    expect(isValidProjectMetadata({ name: " My App " })).toBe(true);
    expect(isValidProjectMetadata({ name: "App" })).toBe(true);
  });
});
