import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Plan, Task } from "@opensprint/shared";
import { TaskDetailLinks } from "./TaskDetailLinks";

const basePlan: Plan = {
  metadata: {
    planId: "plan-1",
    epicId: "epic-1",
    complexity: "medium",
  },
  content: "# Plan",
  status: "building",
  taskCount: 1,
  doneTaskCount: 0,
  dependencyCount: 0,
};

const baseTask: Task = {
  id: "epic-1.1",
  title: "Task A",
  epicId: "epic-1",
  kanbanColumn: "in_progress",
  priority: 0,
  assignee: null,
  type: "task",
  status: "in_progress",
  labels: [],
  dependencies: [],
  description: "",
  createdAt: "",
  updatedAt: "",
};

describe("TaskDetailLinks", () => {
  it("does not render a Links section heading", () => {
    const dep: Task = {
      ...baseTask,
      id: "epic-1.2",
      title: "Blocked task",
      kanbanColumn: "done",
      status: "closed",
    };
    const task: Task = {
      ...baseTask,
      dependencies: [{ targetId: "epic-1.2", type: "blocks" }],
    };
    render(
      <TaskDetailLinks
        projectId="p1"
        selectedTask={task.id}
        task={task}
        planByEpicId={{ "epic-1": basePlan }}
        taskById={{ [dep.id]: dep }}
        allTasks={[task, dep]}
        onNavigateToPlan={vi.fn()}
        onSelectTask={vi.fn()}
        setDeleteLinkConfirm={vi.fn()}
        removeLinkRemovingId={null}
        onAddLink={vi.fn()}
      />
    );
    expect(screen.queryByText("Links:")).not.toBeInTheDocument();
    expect(screen.getByText("Blocked task")).toBeInTheDocument();
  });

  it("still renders Plan control and Add link without a Links heading", () => {
    render(
      <TaskDetailLinks
        projectId="p1"
        selectedTask={baseTask.id}
        task={baseTask}
        planByEpicId={{ "epic-1": basePlan }}
        taskById={{}}
        allTasks={[baseTask]}
        onNavigateToPlan={vi.fn()}
        onSelectTask={vi.fn()}
        setDeleteLinkConfirm={vi.fn()}
        removeLinkRemovingId={null}
        onAddLink={vi.fn()}
      />
    );
    expect(screen.queryByText("Links:")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-view-plan-btn")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-add-link-btn")).toBeInTheDocument();
  });
});
