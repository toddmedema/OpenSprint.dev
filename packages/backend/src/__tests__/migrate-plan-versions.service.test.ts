/**
 * Tests for migrate-plan-versions one-time migration: existing plans get v1,
 * idempotent re-run does not duplicate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  migratePlanVersions,
  titleFromFirstHeading,
} from "../services/migrate-plan-versions.service.js";
import type { DbClient } from "../db/client.js";

function createMockClient(): DbClient {
  return {
    query: vi.fn(),
    queryOne: vi.fn(),
    execute: vi.fn(),
    runInTransaction: vi.fn(),
  };
}

describe("titleFromFirstHeading", () => {
  it("returns text after first # heading", () => {
    expect(titleFromFirstHeading("# My Plan\n\nBody")).toBe("My Plan");
    expect(titleFromFirstHeading("  #  Title With Spaces  \n")).toBe("Title With Spaces");
  });

  it("returns null when no # heading", () => {
    expect(titleFromFirstHeading("No heading")).toBeNull();
    expect(titleFromFirstHeading("")).toBeNull();
    expect(titleFromFirstHeading("## Only H2")).toBe("Only H2");
  });

  it("uses first # line only", () => {
    expect(titleFromFirstHeading("# First\n# Second")).toBe("First");
  });
});

describe("migratePlanVersions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns migrated 0 when no plans have null current_version_number", async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue([]);

    const result = await migratePlanVersions(client);

    expect(result.migrated).toBe(0);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("inserts one plan_version and updates plan when one plan has null version (not executed)", async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValueOnce([
      {
        project_id: "proj1",
        plan_id: "plan1",
        content: "# My Plan\n\nBody",
        metadata: "{}",
        shipped_content: null,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    vi.mocked(client.execute).mockResolvedValue(1);

    const result = await migratePlanVersions(client);

    expect(result.migrated).toBe(1);
    expect(client.execute).toHaveBeenCalledTimes(2);
    const insertCall = vi
      .mocked(client.execute)
      .mock.calls.find((c) => String(c[0]).includes("INSERT INTO plan_versions"));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([
      "proj1",
      "plan1",
      "My Plan",
      "# My Plan\n\nBody",
      "{}",
      "2026-01-01T00:00:00Z",
      0,
    ]);
    const updateCall = vi
      .mocked(client.execute)
      .mock.calls.find((c) => String(c[0]).includes("UPDATE plans"));
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([null, "proj1", "plan1"]);
  });

  it("sets is_executed_version=1 and last_executed_version_number=1 when plan has shipped_content", async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValueOnce([
      {
        project_id: "p",
        plan_id: "x",
        content: "# Shipped Plan\nDone",
        metadata: "{}",
        shipped_content: "shipped body",
        updated_at: "2026-02-01T00:00:00Z",
      },
    ]);
    vi.mocked(client.execute).mockResolvedValue(1);

    const result = await migratePlanVersions(client);

    expect(result.migrated).toBe(1);
    const insertCall = vi
      .mocked(client.execute)
      .mock.calls.find((c) => String(c[0]).includes("INSERT INTO plan_versions"));
    expect(insertCall![1]).toEqual([
      "p",
      "x",
      "Shipped Plan",
      "# Shipped Plan\nDone",
      "{}",
      "2026-02-01T00:00:00Z",
      1,
    ]);
    const updateCall = vi
      .mocked(client.execute)
      .mock.calls.find((c) => String(c[0]).includes("UPDATE plans"));
    expect(updateCall![1]).toEqual([1, "p", "x"]);
  });

  it("treats metadata.shippedAt as executed", async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValueOnce([
      {
        project_id: "p",
        plan_id: "y",
        content: "# Plan",
        metadata: JSON.stringify({ shippedAt: "2026-01-01T00:00:00Z" }),
        shipped_content: null,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    vi.mocked(client.execute).mockResolvedValue(1);

    await migratePlanVersions(client);

    const updateCall = vi
      .mocked(client.execute)
      .mock.calls.find((c) => String(c[0]).includes("UPDATE plans"));
    expect(updateCall![1]).toEqual([1, "p", "y"]);
  });

  it("uses null title when content has no # heading", async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValueOnce([
      {
        project_id: "p",
        plan_id: "z",
        content: "No heading here",
        metadata: "{}",
        shipped_content: null,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    vi.mocked(client.execute).mockResolvedValue(1);

    await migratePlanVersions(client);

    const insertCall = vi
      .mocked(client.execute)
      .mock.calls.find((c) => String(c[0]).includes("INSERT INTO plan_versions"));
    expect(insertCall![1][2]).toBeNull();
  });
});

it("is idempotent: only migrates rows where current_version_number IS NULL", async () => {
  const client = createMockClient();
  vi.mocked(client.query).mockResolvedValueOnce([
    {
      project_id: "p",
      plan_id: "q",
      content: "# P",
      metadata: "{}",
      shipped_content: null,
      updated_at: "2026-01-01T00:00:00Z",
    },
  ]);
  vi.mocked(client.execute).mockResolvedValue(1);

  const { migratePlanVersions: run } = await import("../services/migrate-plan-versions.service.js");
  const first = await run(client);
  expect(first.migrated).toBe(1);

  // Second run: no rows with null (we would have updated them), so query returns []
  vi.mocked(client.query).mockResolvedValue([]);
  const second = await run(client);
  expect(second.migrated).toBe(0);
});
