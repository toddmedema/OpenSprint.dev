/**
 * GitHub Issues provider adapter.
 * Uses the GitHub REST API with a personal access token (PAT) or OAuth app token.
 */

import type { IntegrationConnection, IntegrationSourceOption } from "@opensprint/shared";
import type {
  IntegrationAdapter,
  AdapterCapabilities,
  RawExternalItem,
  NormalizedIntakeItem,
} from "../integration-adapter.js";
import { adapterRegistry } from "../integration-adapter.js";
const GITHUB_API = "https://api.github.com";
const MAX_ISSUES_PER_FETCH = 50;

async function ghFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

interface GHRepo { id: number; full_name: string; open_issues_count?: number }
interface GHIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  labels: { name: string }[];
  created_at: string;
  html_url: string;
  pull_request?: unknown;
}

export class GitHubAdapter implements IntegrationAdapter {
  readonly provider = "github" as const;
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
    const repos = await ghFetch<GHRepo[]>(
      "/user/repos?sort=updated&per_page=100&type=all",
      decryptedToken
    );
    return repos.map((r) => ({
      id: String(r.id),
      name: r.full_name,
      itemCount: r.open_issues_count,
    }));
  }

  async fetchItems(
    connection: IntegrationConnection,
    decryptedToken: string
  ): Promise<RawExternalItem[]> {
    const repoFullName = connection.provider_resource_name;
    if (!repoFullName) return [];

    const issues = await ghFetch<GHIssue[]>(
      `/repos/${repoFullName}/issues?state=open&sort=created&direction=asc&per_page=${MAX_ISSUES_PER_FETCH}`,
      decryptedToken
    );

    return issues
      .filter((i) => !i.pull_request)
      .map((issue) => ({
        externalId: String(issue.number),
        title: issue.title,
        body: issue.body ?? undefined,
        author: issue.user?.login,
        labels: issue.labels.map((l) => l.name),
        createdAt: issue.created_at,
        sourceRef: issue.html_url,
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

export const githubAdapter = new GitHubAdapter();
adapterRegistry.register(githubAdapter);
