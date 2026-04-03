/**
 * Todoist provider adapter implementing the IntegrationAdapter contract.
 * Wraps the existing TodoistApiClient and OAuth helpers.
 */

import type { IntegrationConnection, IntegrationSourceOption } from "@opensprint/shared";
import type {
  IntegrationAdapter,
  AdapterCapabilities,
  RawExternalItem,
  NormalizedIntakeItem,
  OAuthResult,
} from "../integration-adapter.js";
import {
  TodoistApiClient,
  getTodoistOAuthConfig,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  revokeAccessToken,
} from "../todoist-api-client.service.js";
import { adapterRegistry } from "../integration-adapter.js";

const MAX_TASKS_PER_FETCH = 50;

export class TodoistAdapter implements IntegrationAdapter {
  readonly provider = "todoist" as const;
  readonly capabilities: AdapterCapabilities = {
    supportsOAuth: true,
    supportsPoll: true,
    supportsWebhook: false,
    supportsSourceSelection: true,
    supportsDelete: true,
  };

  buildAuthorizationUrl(state: string): string {
    const config = getTodoistOAuthConfig();
    return buildAuthorizationUrl(config.clientId, ["data:read_write"], state);
  }

  async exchangeToken(code: string, _state: string): Promise<OAuthResult> {
    const config = getTodoistOAuthConfig();
    const result = await exchangeCodeForToken(config.clientId, config.clientSecret, code);
    return {
      accessToken: result.accessToken,
      scopes: "data:read_write",
    };
  }

  async revokeToken(accessToken: string): Promise<void> {
    const config = getTodoistOAuthConfig();
    await revokeAccessToken(config.clientId, config.clientSecret, accessToken);
  }

  async listSources(
    _connection: IntegrationConnection,
    decryptedToken: string
  ): Promise<IntegrationSourceOption[]> {
    const client = new TodoistApiClient(decryptedToken);
    const projects = await client.getProjects();
    return projects.map((p) => ({ id: p.id, name: p.name }));
  }

  async fetchItems(
    connection: IntegrationConnection,
    decryptedToken: string
  ): Promise<RawExternalItem[]> {
    if (!connection.provider_resource_id) return [];

    const client = new TodoistApiClient(decryptedToken);
    const tasks = await client.getTasks(connection.provider_resource_id);

    tasks.sort((a, b) => (a.addedAt ?? "").localeCompare(b.addedAt ?? ""));

    return tasks.slice(0, MAX_TASKS_PER_FETCH).map((task) => ({
      externalId: task.id,
      title: task.content,
      body: task.description?.trim() || undefined,
      labels: task.labels,
      priority: task.priority,
      createdAt: task.addedAt ?? undefined,
      sourceRef: connection.provider_resource_id ?? undefined,
    }));
  }

  normalizeItem(raw: RawExternalItem): NormalizedIntakeItem {
    return {
      external_item_id: raw.externalId,
      title: raw.title,
      body: raw.body ?? null,
      author: raw.author ?? null,
      labels: raw.labels ?? [],
      source_ref: raw.sourceRef ?? null,
      external_created_at: raw.createdAt ?? null,
    };
  }

  async acknowledgeItem(externalItemId: string, decryptedToken: string): Promise<void> {
    const client = new TodoistApiClient(decryptedToken);
    await client.deleteTask(externalItemId);
  }
}

export const todoistAdapter = new TodoistAdapter();
adapterRegistry.register(todoistAdapter);
