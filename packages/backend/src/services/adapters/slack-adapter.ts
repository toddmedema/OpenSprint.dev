/**
 * Slack provider adapter.
 * Uses Slack Web API with a bot token to ingest messages from a selected channel.
 */

import type { IntegrationConnection, IntegrationSourceOption } from "@opensprint/shared";
import type {
  IntegrationAdapter,
  AdapterCapabilities,
  RawExternalItem,
  NormalizedIntakeItem,
} from "../integration-adapter.js";
import { adapterRegistry } from "../integration-adapter.js";
const SLACK_API = "https://slack.com/api";
const MAX_MESSAGES_PER_FETCH = 50;

async function slackFetch<T>(method: string, token: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${SLACK_API}/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Slack API ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error ?? "unknown"}`);
  }
  return data;
}

interface SlackChannel { id: string; name: string; num_members?: number }
interface SlackMessage {
  ts: string;
  text: string;
  user?: string;
  thread_ts?: string;
}

export class SlackAdapter implements IntegrationAdapter {
  readonly provider = "slack" as const;
  readonly capabilities: AdapterCapabilities = {
    supportsOAuth: false,
    supportsPoll: true,
    supportsWebhook: false,
    supportsSourceSelection: true,
    supportsDelete: false,
  };

  async listSources(
    _connection: IntegrationConnection,
    decryptedToken: string
  ): Promise<IntegrationSourceOption[]> {
    const result = await slackFetch<{ channels: SlackChannel[] }>(
      "conversations.list",
      decryptedToken,
      { types: "public_channel,private_channel", limit: "200", exclude_archived: "true" }
    );
    return (result.channels ?? []).map((ch) => ({
      id: ch.id,
      name: `#${ch.name}`,
      itemCount: ch.num_members,
    }));
  }

  async fetchItems(
    connection: IntegrationConnection,
    decryptedToken: string
  ): Promise<RawExternalItem[]> {
    const channelId = connection.provider_resource_id;
    if (!channelId) return [];

    const lastSyncTs = connection.last_sync_at
      ? String(new Date(connection.last_sync_at).getTime() / 1000)
      : undefined;

    const params: Record<string, string> = {
      channel: channelId,
      limit: String(MAX_MESSAGES_PER_FETCH),
    };
    if (lastSyncTs) params.oldest = lastSyncTs;

    const result = await slackFetch<{ messages: SlackMessage[] }>(
      "conversations.history",
      decryptedToken,
      params
    );

    return (result.messages ?? [])
      .filter((m) => !m.thread_ts || m.thread_ts === m.ts)
      .map((msg) => ({
        externalId: msg.ts,
        title: msg.text.slice(0, 120) || "(no text)",
        body: msg.text,
        author: msg.user,
        createdAt: new Date(parseFloat(msg.ts) * 1000).toISOString(),
        sourceRef: `slack://${channelId}/${msg.ts}`,
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
}

export const slackAdapter = new SlackAdapter();
adapterRegistry.register(slackAdapter);
