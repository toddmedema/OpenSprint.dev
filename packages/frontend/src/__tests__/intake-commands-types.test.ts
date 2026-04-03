import { describe, it, expect } from "vitest";
import type {
  IntakeItem,
  IntakeTriageStatus,
  IntakeConvertAction,
  IntegrationProvider,
  CommandIntent,
  CommandRiskLevel,
  CommandStatus,
  CommandRun,
} from "@opensprint/shared";

describe("Shared intake types contract", () => {
  it("IntakeTriageStatus covers all lifecycle states", () => {
    const statuses: IntakeTriageStatus[] = ["new", "triaged", "converted", "ignored"];
    expect(statuses).toHaveLength(4);
  });

  it("IntakeConvertAction covers all action types", () => {
    const actions: IntakeConvertAction[] = ["to_feedback", "to_task_draft", "link_existing", "ignore"];
    expect(actions).toHaveLength(4);
  });

  it("IntegrationProvider includes all configured providers", () => {
    const providers: IntegrationProvider[] = ["todoist", "github", "slack", "webhook"];
    expect(providers).toHaveLength(4);
  });

  it("IntakeItem shape can be constructed", () => {
    const item: IntakeItem = {
      id: "test-id",
      project_id: "proj-1",
      provider: "todoist",
      external_item_id: "ext-1",
      source_ref: null,
      title: "Test Item",
      body: null,
      author: null,
      labels: [],
      triage_status: "new",
      triage_suggestion: null,
      converted_feedback_id: null,
      converted_task_id: null,
      external_created_at: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    expect(item.id).toBe("test-id");
    expect(item.triage_status).toBe("new");
  });
});

describe("Shared command types contract", () => {
  it("CommandRiskLevel covers all risk levels", () => {
    const levels: CommandRiskLevel[] = ["safe", "mutating-low-risk", "mutating-high-risk"];
    expect(levels).toHaveLength(3);
  });

  it("CommandStatus covers all states", () => {
    const statuses: CommandStatus[] = [
      "interpreting", "previewing", "awaiting_confirmation",
      "executing", "completed", "failed", "cancelled",
    ];
    expect(statuses).toHaveLength(7);
  });

  it("CommandIntent discriminated union works", () => {
    const intent: CommandIntent = {
      commandType: "list_intake",
      args: { provider: "github" },
    };
    expect(intent.commandType).toBe("list_intake");

    const unrecognized: CommandIntent = {
      commandType: "unrecognized",
      args: { rawInput: "foo" },
    };
    expect(unrecognized.commandType).toBe("unrecognized");
  });

  it("CommandRun shape can be constructed", () => {
    const run: CommandRun = {
      id: "run-1",
      project_id: "proj-1",
      actor: "user",
      raw_input: "list tasks",
      interpreted_command: { commandType: "list_tasks", args: {} },
      risk_level: "safe",
      status: "completed",
      preview: null,
      result: { success: true, steps: [], summary: "Listed 0 tasks" },
      idempotency_key: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    expect(run.status).toBe("completed");
  });
});
