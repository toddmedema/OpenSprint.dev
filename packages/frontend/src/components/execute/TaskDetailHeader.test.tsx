// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskDetailHeader } from "./TaskDetailHeader";

const noop = () => {};
const asyncNoop = async () => {};

const baseProps = {
  title: "Test task",
  hasActions: true,
  isBlockedTask: false,
  isDoneTask: false,
  markDoneLoading: false,
  unblockLoading: false,
  deleteLoading: false,
  forceRetryLoading: false,
  onClose: noop,
  onMarkDone: noop,
  onUnblock: noop,
  onDeleteTask: asyncNoop,
  onForceRetry: asyncNoop,
  deleteConfirmOpen: false,
  setDeleteConfirmOpen: vi.fn(),
  deleteLinkConfirm: null as null,
  setDeleteLinkConfirm: vi.fn(),
  removeLinkRemovingId: null as string | null,
  onRemoveLink: asyncNoop,
};

function DeleteConfirmHarness() {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(true);
  return (
    <TaskDetailHeader
      {...baseProps}
      deleteConfirmOpen={deleteConfirmOpen}
      setDeleteConfirmOpen={setDeleteConfirmOpen}
    />
  );
}

describe("TaskDetailHeader", () => {
  it("closes delete confirmation dialog on Escape via useModalA11y", () => {
    render(<DeleteConfirmHarness />);

    expect(screen.getByTestId("sidebar-delete-task-dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("sidebar-delete-task-dialog")).not.toBeInTheDocument();
  });
});
