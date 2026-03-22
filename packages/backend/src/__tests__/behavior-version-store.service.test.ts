import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { DbClient } from "../db/client.js";
import { runSchema } from "../db/schema.js";
import { createTestPostgresClient, truncateTestDbTables } from "./test-db-helper.js";
import { BehaviorVersionStore } from "../services/behavior-version-store.core.js";

describe("BehaviorVersionStore", () => {
  let client: DbClient | null = null;

  beforeAll(async () => {
    const result = await createTestPostgresClient();
    if (!result) return;
    client = result.client;
    await runSchema(client);
  });

  beforeEach(async () => {
    if (!client) return;
    await truncateTestDbTables(client);
  });

  it.skipIf(!client)("promoteToActive persists version row and active pointer", async () => {
    const store = new BehaviorVersionStore(() => client!);
    const promotedAt = "2026-03-21T12:00:00.000Z";
    await store.promoteToActive("proj-x", "bv-promo-1", promotedAt, "tpl-42");

    const row = await client!.queryOne(
      "SELECT id, project_id, template_version_id, promoted_at, version_type FROM behavior_versions WHERE project_id = $1 AND id = $2",
      ["proj-x", "bv-promo-1"]
    );
    expect(row).toMatchObject({
      id: "bv-promo-1",
      project_id: "proj-x",
      template_version_id: "tpl-42",
      promoted_at: promotedAt,
      version_type: "promoted",
    });

    const state = await client!.queryOne(
      "SELECT active_promoted_version_id FROM project_behavior_state WHERE project_id = $1",
      ["proj-x"]
    );
    expect(state).toMatchObject({ active_promoted_version_id: "bv-promo-1" });
  });

  it.skipIf(!client)("setActivePromoted updates pointer only", async () => {
    const store = new BehaviorVersionStore(() => client!);
    await store.promoteToActive("proj-x", "bv-a", "2026-03-21T10:00:00.000Z", null);
    await store.promoteToActive("proj-x", "bv-b", "2026-03-21T11:00:00.000Z", null);
    await store.setActivePromoted("proj-x", "bv-a");

    const state = await client!.queryOne(
      "SELECT active_promoted_version_id FROM project_behavior_state WHERE project_id = $1",
      ["proj-x"]
    );
    expect(state).toMatchObject({ active_promoted_version_id: "bv-a" });
  });

  it.skipIf(!client)("resolveActiveForExecute returns template from store", async () => {
    const store = new BehaviorVersionStore(() => client!);
    await store.promoteToActive("proj-x", "bv-tpl", "2026-03-21T10:00:00.000Z", "tpl-z");

    const resolved = await store.resolveActiveForExecute("proj-x", "bv-tpl", [
      { id: "bv-tpl", promotedAt: "2026-03-21T10:00:00.000Z" },
    ]);
    expect(resolved).toEqual({
      behaviorVersionId: "bv-tpl",
      templateVersionId: "tpl-z",
    });
  });

  it.skipIf(!client)("readActivePromotedReplayBinding reads pointer and template from store", async () => {
    const store = new BehaviorVersionStore(() => client!);
    await store.promoteToActive("proj-x", "bv-read", "2026-03-21T09:00:00.000Z", "tpl-read");

    const binding = await store.readActivePromotedReplayBinding("proj-x");
    expect(binding).toEqual({
      behaviorVersionId: "bv-read",
      templateVersionId: "tpl-read",
    });
  });

  it.skipIf(!client)("readActivePromotedReplayBinding returns null when no project_behavior_state row", async () => {
    const store = new BehaviorVersionStore(() => client!);
    const binding = await store.readActivePromotedReplayBinding("proj-empty");
    expect(binding).toBeNull();
  });
});
