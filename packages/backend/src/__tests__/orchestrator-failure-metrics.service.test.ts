import { describe, it, expect } from "vitest";
import {
  rollupOrchestratorEvents,
  resolveFailureMetricsWindow,
} from "../services/orchestrator-failure-metrics.service.js";
import type { OrchestratorEvent } from "../services/event-log.service.js";

describe("orchestrator-failure-metrics.service", () => {
  it("resolveFailureMetricsWindow defaults to 14 days when days omitted", () => {
    const w = resolveFailureMetricsWindow(undefined);
    expect(w.daysUsed).toBe(14);
    expect(Date.parse(w.untilIso)).toBeGreaterThan(Date.parse(w.sinceIso));
  });

  it("rollupOrchestratorEvents groups by event and failure fields", () => {
    const since = "2025-01-01T00:00:00.000Z";
    const until = "2025-01-31T00:00:00.000Z";
    const events: OrchestratorEvent[] = [
      {
        timestamp: "2025-01-05T00:00:00.000Z",
        projectId: "p1",
        taskId: "a",
        event: "task.failed",
        data: { failureType: "timeout", phase: "coding" },
      },
      {
        timestamp: "2025-01-06T00:00:00.000Z",
        projectId: "p1",
        taskId: "b",
        event: "task.failed",
        data: { failureType: "timeout", phase: "coding" },
      },
      {
        timestamp: "2025-01-07T00:00:00.000Z",
        projectId: "p1",
        taskId: "c",
        event: "merge.failed",
        data: { failureType: "merge_quality_gate", stage: "quality_gate", phase: "merge" },
      },
      {
        timestamp: "2025-01-08T00:00:00.000Z",
        projectId: "p1",
        taskId: "d",
        event: "transition.x",
      },
    ];
    const summary = rollupOrchestratorEvents("p1", since, until, events);
    expect(summary.totalEventsMatched).toBe(3);
    expect(summary.buckets).toHaveLength(2);
    expect(summary.buckets[0]).toMatchObject({
      event: "task.failed",
      failureType: "timeout",
      phase: "coding",
      count: 2,
    });
    expect(summary.buckets[1]).toMatchObject({
      event: "merge.failed",
      failureType: "merge_quality_gate",
      mergeStage: "quality_gate",
      count: 1,
    });
  });

  it("derives language-agnostic signature buckets for environment and quality-gate failures", () => {
    const summary = rollupOrchestratorEvents(
      "p2",
      "2025-01-01T00:00:00.000Z",
      "2025-01-31T00:00:00.000Z",
      [
        {
          timestamp: "2025-01-05T00:00:00.000Z",
          projectId: "p2",
          taskId: "a",
          event: "merge.failed",
          data: {
            failureType: "environment_setup",
            mergeStage: "quality_gate",
            qualityGateCategory: "environment_setup",
            qualityGateFirstErrorLine: "Validation workspace package.json is missing",
          },
        },
        {
          timestamp: "2025-01-06T00:00:00.000Z",
          projectId: "p2",
          taskId: "b",
          event: "task.requeued",
          data: {
            failureType: "environment_setup",
            mergeStage: "quality_gate",
            qualityGateCategory: "environment_setup",
            qualityGateClassificationConfidence: "low",
            failedGateReason: "Cannot resolve project for repo path /tmp/repo",
          },
        },
        {
          timestamp: "2025-01-07T00:00:00.000Z",
          projectId: "p2",
          taskId: "c",
          event: "merge.failed",
          data: {
            failureType: "merge_quality_gate",
            mergeStage: "quality_gate",
            qualityGateCategory: "quality_gate",
            failedGateReason: "AssertionError: expected 401 to be 200",
          },
        },
      ] as OrchestratorEvent[]
    );

    expect(summary.totalEventsMatched).toBe(3);
    expect(summary.buckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signatureBucket: "workspace_preflight",
          qualityGateCategory: "environment_setup",
        }),
        expect.objectContaining({
          signatureBucket: "project_resolution",
          classificationConfidence: "low",
        }),
        expect.objectContaining({
          signatureBucket: "deterministic_code_regression",
          qualityGateCategory: "quality_gate",
        }),
      ])
    );
  });

  it("rolls up policy, no-result, and recovery signatures", () => {
    const summary = rollupOrchestratorEvents(
      "p3",
      "2025-01-01T00:00:00.000Z",
      "2025-01-31T00:00:00.000Z",
      [
        {
          timestamp: "2025-01-05T00:00:00.000Z",
          projectId: "p3",
          taskId: "a",
          event: "task.requeued",
          data: {
            failureType: "no_result",
            noResultReasonCode: "result_invalid_json",
            policyDecision: "requeue",
          },
        },
        {
          timestamp: "2025-01-06T00:00:00.000Z",
          projectId: "p3",
          taskId: "b",
          event: "task.blocked",
          data: {
            failureType: "timeout",
            policyDecision: "block",
          },
        },
        {
          timestamp: "2025-01-07T00:00:00.000Z",
          projectId: "p3",
          taskId: "c",
          event: "recovery.stale_heartbeat",
          data: { staleSec: 600 },
        },
      ] as OrchestratorEvent[]
    );

    expect(summary.totalEventsMatched).toBe(3);
    expect(summary.buckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "task.requeued",
          signatureBucket: "no_result:result_invalid_json",
        }),
        expect.objectContaining({
          event: "task.blocked",
          signatureBucket: "policy:block",
        }),
        expect.objectContaining({
          event: "recovery.stale_heartbeat",
          signatureBucket: "recovery_stale_heartbeat",
        }),
      ])
    );
  });
});
