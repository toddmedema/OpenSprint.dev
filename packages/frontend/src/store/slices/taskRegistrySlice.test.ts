import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import taskRegistryReducer, {
  mergeTasks,
  mergeTask,
  mergeTaskUpdate,
  clearRegistry,
  selectTaskSummariesByProject,
  selectTaskTitle,
} from "./taskRegistrySlice";
import type { Task } from "@opensprint/shared";

const mockTask: Task = {
  id: "task-1",
  title: "Task 1",
  description: "",
  type: "task",
  status: "open",
  priority: 1,
  assignee: null,
  labels: [],
  dependencies: [],
  epicId: "epic-1",
  kanbanColumn: "backlog",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const mockTask2: Task = {
  ...mockTask,
  id: "task-2",
  title: "Task 2",
  priority: 2,
  kanbanColumn: "in_progress",
};

function createStore() {
  return configureStore({
    reducer: { taskRegistry: taskRegistryReducer },
  });
}

describe("taskRegistrySlice", () => {
  describe("reducers", () => {
    it("mergeTasks adds entries for the given projectId", () => {
      const store = createStore();
      store.dispatch(mergeTasks({ projectId: "proj-1", tasks: [mockTask, mockTask2] }));
      const byProject = store.getState().taskRegistry.byProject;
      expect(byProject["proj-1"]).toBeDefined();
      expect(byProject["proj-1"]["task-1"]).toEqual({
        title: "Task 1",
        kanbanColumn: "backlog",
        priority: 1,
      });
      expect(byProject["proj-1"]["task-2"]).toEqual({
        title: "Task 2",
        kanbanColumn: "in_progress",
        priority: 2,
      });
    });

    it("mergeTask adds one entry", () => {
      const store = createStore();
      store.dispatch(mergeTask({ projectId: "proj-1", task: mockTask }));
      const byProject = store.getState().taskRegistry.byProject;
      expect(byProject["proj-1"]["task-1"]).toEqual({
        title: "Task 1",
        kanbanColumn: "backlog",
        priority: 1,
      });
    });

    it("mergeTaskUpdate updates kanbanColumn and priority when entry exists", () => {
      const store = createStore();
      store.dispatch(mergeTasks({ projectId: "proj-1", tasks: [mockTask] }));
      store.dispatch(
        mergeTaskUpdate({
          projectId: "proj-1",
          taskId: "task-1",
          status: "closed",
          priority: 0,
        })
      );
      const entry = store.getState().taskRegistry.byProject["proj-1"]["task-1"];
      expect(entry.kanbanColumn).toBe("done");
      expect(entry.priority).toBe(0);
      expect(entry.title).toBe("Task 1");
    });

    it("mergeTaskUpdate does nothing when entry is missing", () => {
      const store = createStore();
      store.dispatch(
        mergeTaskUpdate({
          projectId: "proj-1",
          taskId: "task-1",
          status: "closed",
        })
      );
      expect(store.getState().taskRegistry.byProject["proj-1"]).toBeUndefined();
    });

    it("clearRegistry sets byProject to empty", () => {
      const store = createStore();
      store.dispatch(mergeTasks({ projectId: "proj-1", tasks: [mockTask] }));
      store.dispatch(clearRegistry());
      expect(store.getState().taskRegistry.byProject).toEqual({});
    });
  });

  describe("extraReducers", () => {
    it("execute/fetchTasks.fulfilled merges tasks into registry", () => {
      const store = createStore();
      store.dispatch({
        type: "execute/fetchTasks.fulfilled",
        payload: [mockTask, mockTask2],
        meta: { arg: "proj-1" },
      });
      const summaries = selectTaskSummariesByProject(store.getState(), "proj-1");
      expect(Object.keys(summaries)).toHaveLength(2);
      expect(summaries["task-1"].title).toBe("Task 1");
      expect(summaries["task-2"].title).toBe("Task 2");
    });

    it("execute/fetchTaskDetail.fulfilled merges single task", () => {
      const store = createStore();
      store.dispatch({
        type: "execute/fetchTaskDetail.fulfilled",
        payload: mockTask,
        meta: { arg: { projectId: "proj-1", taskId: "task-1" } },
      });
      expect(selectTaskTitle(store.getState(), "proj-1", "task-1")).toBe("Task 1");
    });

    it("execute/resetExecute clears byProject", () => {
      const store = createStore();
      store.dispatch(mergeTasks({ projectId: "proj-1", tasks: [mockTask] }));
      store.dispatch({ type: "execute/resetExecute" });
      expect(store.getState().taskRegistry.byProject).toEqual({});
    });

    it("execute/markTaskDone.fulfilled merges tasks", () => {
      const store = createStore();
      store.dispatch({
        type: "execute/markTaskDone.fulfilled",
        payload: { tasks: [mockTask] },
        meta: { arg: { projectId: "proj-1", taskId: "task-1" } },
      });
      expect(selectTaskSummariesByProject(store.getState(), "proj-1")["task-1"]).toBeDefined();
    });

    it("execute/unblockTask.fulfilled merges tasks", () => {
      const store = createStore();
      store.dispatch({
        type: "execute/unblockTask.fulfilled",
        payload: { tasks: [mockTask], taskUnblocked: true },
        meta: { arg: { projectId: "proj-1", taskId: "task-1" } },
      });
      expect(selectTaskSummariesByProject(store.getState(), "proj-1")["task-1"]).toBeDefined();
    });

    it("execute/updateTaskPriority.fulfilled merges task", () => {
      const store = createStore();
      store.dispatch({
        type: "execute/updateTaskPriority.fulfilled",
        payload: { task: { ...mockTask, priority: 0 }, taskId: "task-1" },
        meta: { arg: { projectId: "proj-1", taskId: "task-1", priority: 0, previousPriority: 1 } },
      });
      expect(selectTaskSummariesByProject(store.getState(), "proj-1")["task-1"].priority).toBe(0);
    });
  });

  describe("selectors", () => {
    it("selectTaskSummariesByProject returns empty object when project missing", () => {
      const store = createStore();
      expect(selectTaskSummariesByProject(store.getState(), "proj-1")).toEqual({});
    });

    it("selectTaskTitle returns undefined when task missing", () => {
      const store = createStore();
      store.dispatch(mergeTasks({ projectId: "proj-1", tasks: [mockTask] }));
      expect(selectTaskTitle(store.getState(), "proj-1", "other")).toBeUndefined();
    });
  });
});
