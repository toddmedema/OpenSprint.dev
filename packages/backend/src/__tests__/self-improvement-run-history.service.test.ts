import { describe, it, expect, vi, beforeEach } from "vitest";
import { SelfImprovementRunHistoryStore } from "../services/self-improvement-run-history.service.js";

describe("SelfImprovementRunHistoryStore", () => {
  let mockClient: {
    queryOne: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockClient = {
      queryOne: vi.fn(),
      query: vi.fn(),
      execute: vi.fn(),
    };
  });

  it("insert returns record with timestamp, status, tasksCreatedCount", async () => {
    const completedAt = "2025-03-10T12:00:00.000Z";
    mockClient.queryOne.mockResolvedValue({
      id: 1,
      project_id: "proj-1",
      run_id: "si-1",
      completed_at: completedAt,
      status: "success",
      tasks_created_count: 2,
    });

    const store = new SelfImprovementRunHistoryStore(() => mockClient as never);
    const record = await store.insert({
      projectId: "proj-1",
      runId: "si-1",
      completedAt,
      status: "success",
      tasksCreatedCount: 2,
    });

    expect(record).toEqual({
      id: 1,
      projectId: "proj-1",
      runId: "si-1",
      timestamp: completedAt,
      status: "success",
      tasksCreatedCount: 2,
    });
    expect(mockClient.queryOne).toHaveBeenCalled();
  });

  it("listByProjectId returns records ordered by completed_at DESC", async () => {
    const rows = [
      {
        id: 2,
        project_id: "proj-1",
        run_id: "si-2",
        completed_at: "2025-03-10T14:00:00.000Z",
        status: "success",
        tasks_created_count: 1,
      },
      {
        id: 1,
        project_id: "proj-1",
        run_id: "si-1",
        completed_at: "2025-03-10T12:00:00.000Z",
        status: "success",
        tasks_created_count: 3,
      },
    ];
    mockClient.query.mockResolvedValue(rows);

    const store = new SelfImprovementRunHistoryStore(() => mockClient as never);
    const list = await store.listByProjectId("proj-1", 10);

    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      runId: "si-2",
      timestamp: "2025-03-10T14:00:00.000Z",
      tasksCreatedCount: 1,
    });
    expect(list[1]).toMatchObject({
      runId: "si-1",
      timestamp: "2025-03-10T12:00:00.000Z",
      tasksCreatedCount: 3,
    });
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY completed_at DESC"),
      ["proj-1", 10]
    );
  });

  it("listByProjectId uses default limit when not provided", async () => {
    mockClient.query.mockResolvedValue([]);

    const store = new SelfImprovementRunHistoryStore(() => mockClient as never);
    await store.listByProjectId("proj-1");

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.any(String),
      ["proj-1", 50]
    );
  });
});
