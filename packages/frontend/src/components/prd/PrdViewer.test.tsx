import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrdViewer } from "./PrdViewer";

describe("PrdViewer", () => {
  it("renders PRD sections with formatted headers", () => {
    const prdContent = {
      executive_summary: "Summary text",
      goals_and_metrics: "Goals text",
    };
    render(
      <PrdViewer
        prdContent={prdContent}
        editingSection={null}
        editDraft=""
        savingSection={null}
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSaveEdit={vi.fn()}
        onEditDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Executive Summary")).toBeInTheDocument();
    expect(screen.getByText("Goals And Metrics")).toBeInTheDocument();
    expect(screen.getByText("Summary text")).toBeInTheDocument();
  });

  it("shows edit textarea when section is being edited", async () => {
    const user = userEvent.setup();
    const onStartEdit = vi.fn();
    render(
      <PrdViewer
        prdContent={{ overview: "Original" }}
        editingSection={null}
        editDraft=""
        savingSection={null}
        onStartEdit={onStartEdit}
        onCancelEdit={vi.fn()}
        onSaveEdit={vi.fn()}
        onEditDraftChange={vi.fn()}
      />,
    );

    const editBtn = screen.getByRole("button", { name: "Edit", hidden: true });
    await user.click(editBtn);

    expect(onStartEdit).toHaveBeenCalledWith("overview");
  });
});
