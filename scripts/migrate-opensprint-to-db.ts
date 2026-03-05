#!/usr/bin/env npx tsx
/**
 * One-time migration of canonical .opensprint repo files into PostgreSQL.
 *
 * Usage:
 *   npm run migrate:opensprint
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  AGENT_ROLE_CANONICAL_ORDER,
  OPENSPRINT_DIR,
  OPENSPRINT_PATHS,
  SPEC_METADATA_PATH,
} from "@opensprint/shared";
import { getEffectiveDatabaseConfig } from "../packages/backend/src/services/global-settings.service.js";
import { getProjects } from "../packages/backend/src/services/project-index.js";
import { runSchema } from "../packages/backend/src/db/schema.js";
import { createPostgresDbClientFromUrl } from "../packages/backend/src/db/client.js";
import { createLogger } from "../packages/backend/src/utils/logger.js";

const log = createLogger("migrate-opensprint-to-db");

export const MIGRATION_KEYS = {
  prdMetadata: "opensprint_to_db.prd_metadata.v1",
  projectConversations: "opensprint_to_db.project_conversations.v1",
  planningRuns: "opensprint_to_db.planning_runs.v1",
  agentInstructions: "opensprint_to_db.agent_instructions.v1",
  projectWorkflow: "opensprint_to_db.project_workflow.v1",
  helpChatHistories: "opensprint_to_db.help_chat_histories.v1",
} as const;

export type MigrationStats = {
  migratedProjects: number;
  skippedProjects: number;
  projectErrors: Array<{ projectId: string; projectName: string; error: string }>;
  untouchedUnknownFiles: Array<{ projectId: string; projectName: string; files: string[] }>;
};

export type IndexedProject = { id: string; name: string; repoPath: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  return asRecord(parsed);
}

function parseMessages(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry) => entry && typeof entry === "object");
}

function toIsoString(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString();
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readDirJsonFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
  } catch {
    return [];
  }
}

async function readDirMdFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
  } catch {
    return [];
  }
}

async function hasMigration(
  client: {
    queryOne: (sql: string, params?: unknown[]) => Promise<Record<string, unknown> | undefined>;
  },
  projectId: string,
  migrationKey: string
): Promise<boolean> {
  const row = await client.queryOne(
    "SELECT 1 FROM repo_file_migrations WHERE project_id = $1 AND migration_key = $2",
    [projectId, migrationKey]
  );
  return !!row;
}

async function markMigration(
  client: { execute: (sql: string, params?: unknown[]) => Promise<number> },
  projectId: string,
  migrationKey: string
): Promise<void> {
  await client.execute(
    `INSERT INTO repo_file_migrations (project_id, migration_key, applied_at)
     VALUES ($1, $2, $3)
     ON CONFLICT(project_id, migration_key) DO NOTHING`,
    [projectId, migrationKey, new Date().toISOString()]
  );
}

async function deleteMigratedFiles(files: string[]): Promise<void> {
  for (const filePath of files) {
    await fs.unlink(filePath).catch(() => {});
  }
}

function isCanonicalRelativePath(relPath: string): boolean {
  if (relPath === "spec-metadata.json") return true;
  if (relPath === "workflow.json") return true;
  if (/^conversations\/.+\.json$/.test(relPath)) return true;
  if (/^planning-runs\/.+\.json$/.test(relPath)) return true;

  if (/^agents\/.+\.md$/.test(relPath)) {
    const role = relPath.slice("agents/".length, -".md".length);
    return AGENT_ROLE_CANONICAL_ORDER.includes(role as (typeof AGENT_ROLE_CANONICAL_ORDER)[number]);
  }

  return false;
}

async function collectUnknownOpensprintFiles(repoPath: string): Promise<string[]> {
  const opensprintPath = path.join(repoPath, OPENSPRINT_DIR);

  const result: string[] = [];
  const walk = async (dirPath: string, prefix: string): Promise<void> => {
    let entries: Array<import("fs").Dirent>;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, nextPrefix);
      } else if (entry.isFile()) {
        if (!isCanonicalRelativePath(nextPrefix)) {
          result.push(nextPrefix);
        }
      }
    }
  };

  await walk(opensprintPath, "");
  return result.sort();
}

export async function migrateProject(
  client: {
    queryOne: (sql: string, params?: unknown[]) => Promise<Record<string, unknown> | undefined>;
    execute: (sql: string, params?: unknown[]) => Promise<number>;
  },
  project: IndexedProject
): Promise<{ changed: boolean; unknownFiles: string[] }> {
  const repoPath = project.repoPath;
  const opensprintPath = path.join(repoPath, OPENSPRINT_DIR);
  const changedKeys: string[] = [];

  const specMetadataPath = path.join(repoPath, SPEC_METADATA_PATH);
  const conversationsDir = path.join(repoPath, OPENSPRINT_PATHS.conversations);
  const helpChatPath = path.join(conversationsDir, "help.json");
  const planningRunsDir = path.join(repoPath, OPENSPRINT_PATHS.planningRuns);
  const agentsDir = path.join(repoPath, OPENSPRINT_PATHS.agents);
  const workflowPath = path.join(opensprintPath, "workflow.json");

  if (!(await pathExists(opensprintPath))) {
    return { changed: false, unknownFiles: [] };
  }

  // spec-metadata.json -> prd_metadata
  if (!(await hasMigration(client, project.id, MIGRATION_KEYS.prdMetadata))) {
    if (await pathExists(specMetadataPath)) {
      const raw = await fs.readFile(specMetadataPath, "utf-8");
      const parsed = parseJsonObject(raw);
      const now = new Date().toISOString();

      await client.execute(
        `INSERT INTO prd_metadata (project_id, version, change_log, section_versions, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(project_id) DO UPDATE SET
           version = excluded.version,
           change_log = excluded.change_log,
           section_versions = excluded.section_versions,
           updated_at = excluded.updated_at`,
        [
          project.id,
          Number(parsed.version ?? 0),
          JSON.stringify(Array.isArray(parsed.changeLog) ? parsed.changeLog : []),
          JSON.stringify(asRecord(parsed.sectionVersions)),
          now,
        ]
      );
      await deleteMigratedFiles([specMetadataPath]);
    }

    await markMigration(client, project.id, MIGRATION_KEYS.prdMetadata);
    changedKeys.push(MIGRATION_KEYS.prdMetadata);
  }

  // conversations/*.json (except help.json) -> project_conversations
  if (!(await hasMigration(client, project.id, MIGRATION_KEYS.projectConversations))) {
    const conversationFiles = (await readDirJsonFiles(conversationsDir)).filter(
      (name) => name !== "help.json"
    );

    if (conversationFiles.length > 0) {
      const now = new Date().toISOString();
      const filesToDelete: string[] = [];

      for (const fileName of conversationFiles) {
        const fullPath = path.join(conversationsDir, fileName);
        const raw = await fs.readFile(fullPath, "utf-8");
        const parsed = parseJsonObject(raw);

        const contextFromFile = fileName.replace(/\.json$/i, "");
        const context =
          typeof parsed.context === "string" && parsed.context.trim()
            ? parsed.context.trim()
            : contextFromFile;
        const conversationId =
          typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : randomUUID();
        const messages = parseMessages(parsed.messages);
        const createdAt = toIsoString(parsed.createdAt, now);
        const updatedAt = toIsoString(parsed.updatedAt, now);

        await client.execute(
          `INSERT INTO project_conversations (project_id, context, conversation_id, messages, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT(project_id, context) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             messages = excluded.messages,
             updated_at = excluded.updated_at`,
          [project.id, context, conversationId, JSON.stringify(messages), createdAt, updatedAt]
        );
        filesToDelete.push(fullPath);
      }

      await deleteMigratedFiles(filesToDelete);
    }

    await markMigration(client, project.id, MIGRATION_KEYS.projectConversations);
    changedKeys.push(MIGRATION_KEYS.projectConversations);
  }

  // planning-runs/*.json -> planning_runs
  if (!(await hasMigration(client, project.id, MIGRATION_KEYS.planningRuns))) {
    const runFiles = await readDirJsonFiles(planningRunsDir);

    if (runFiles.length > 0) {
      const filesToDelete: string[] = [];

      for (const fileName of runFiles) {
        const fullPath = path.join(planningRunsDir, fileName);
        const raw = await fs.readFile(fullPath, "utf-8");
        const parsed = parseJsonObject(raw);
        const id =
          typeof parsed.id === "string" && parsed.id.trim()
            ? parsed.id.trim()
            : fileName.replace(/\.json$/i, "") || randomUUID();

        const createdAt = toIsoString(parsed.created_at, new Date().toISOString());
        const prdSnapshot = asRecord(parsed.prd_snapshot);
        const plansCreated = Array.isArray(parsed.plans_created)
          ? parsed.plans_created.filter((item): item is string => typeof item === "string")
          : [];

        await client.execute(
          `INSERT INTO planning_runs (id, project_id, created_at, prd_snapshot, plans_created)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT(id) DO UPDATE SET
             project_id = excluded.project_id,
             created_at = excluded.created_at,
             prd_snapshot = excluded.prd_snapshot,
             plans_created = excluded.plans_created`,
          [id, project.id, createdAt, JSON.stringify(prdSnapshot), JSON.stringify(plansCreated)]
        );
        filesToDelete.push(fullPath);
      }

      await deleteMigratedFiles(filesToDelete);
    }

    await markMigration(client, project.id, MIGRATION_KEYS.planningRuns);
    changedKeys.push(MIGRATION_KEYS.planningRuns);
  }

  // agents/<role>.md -> agent_instructions
  if (!(await hasMigration(client, project.id, MIGRATION_KEYS.agentInstructions))) {
    const mdFiles = await readDirMdFiles(agentsDir);
    const filesToDelete: string[] = [];

    for (const fileName of mdFiles) {
      const role = fileName.replace(/\.md$/i, "");
      if (
        !AGENT_ROLE_CANONICAL_ORDER.includes(role as (typeof AGENT_ROLE_CANONICAL_ORDER)[number])
      ) {
        continue;
      }

      const fullPath = path.join(agentsDir, fileName);
      const content = await fs.readFile(fullPath, "utf-8");
      const now = new Date().toISOString();

      await client.execute(
        `INSERT INTO agent_instructions (project_id, role, content, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(project_id, role) DO UPDATE SET
           content = excluded.content,
           updated_at = excluded.updated_at`,
        [project.id, role, content, now]
      );
      filesToDelete.push(fullPath);
    }

    if (filesToDelete.length > 0) {
      await deleteMigratedFiles(filesToDelete);
    }

    await markMigration(client, project.id, MIGRATION_KEYS.agentInstructions);
    changedKeys.push(MIGRATION_KEYS.agentInstructions);
  }

  // workflow.json -> project_workflows
  if (!(await hasMigration(client, project.id, MIGRATION_KEYS.projectWorkflow))) {
    if (await pathExists(workflowPath)) {
      const raw = await fs.readFile(workflowPath, "utf-8");
      const parsed = parseJsonObject(raw);
      const now = new Date().toISOString();
      await client.execute(
        `INSERT INTO project_workflows (project_id, workflow, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(project_id) DO UPDATE SET
           workflow = excluded.workflow,
           updated_at = excluded.updated_at`,
        [project.id, JSON.stringify(parsed), now]
      );
      await deleteMigratedFiles([workflowPath]);
    }

    await markMigration(client, project.id, MIGRATION_KEYS.projectWorkflow);
    changedKeys.push(MIGRATION_KEYS.projectWorkflow);
  }

  // conversations/help.json -> help_chat_histories
  if (!(await hasMigration(client, project.id, MIGRATION_KEYS.helpChatHistories))) {
    if (await pathExists(helpChatPath)) {
      const raw = await fs.readFile(helpChatPath, "utf-8");
      const parsed = parseJsonObject(raw);
      const messages = parseMessages(parsed.messages);
      const now = new Date().toISOString();
      await client.execute(
        `INSERT INTO help_chat_histories (scope_key, messages, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(scope_key) DO UPDATE SET
           messages = excluded.messages,
           updated_at = excluded.updated_at`,
        [`project:${project.id}`, JSON.stringify(messages), now]
      );
      await deleteMigratedFiles([helpChatPath]);
    }

    await markMigration(client, project.id, MIGRATION_KEYS.helpChatHistories);
    changedKeys.push(MIGRATION_KEYS.helpChatHistories);
  }

  const unknownFiles = await collectUnknownOpensprintFiles(repoPath);
  return {
    changed: changedKeys.length > 0,
    unknownFiles,
  };
}

export async function migrateProjectsWithClient(
  client: {
    queryOne: (sql: string, params?: unknown[]) => Promise<Record<string, unknown> | undefined>;
    execute: (sql: string, params?: unknown[]) => Promise<number>;
  },
  projects: IndexedProject[]
): Promise<MigrationStats> {
  const stats: MigrationStats = {
    migratedProjects: 0,
    skippedProjects: 0,
    projectErrors: [],
    untouchedUnknownFiles: [],
  };

  for (const project of projects) {
    try {
      const result = await migrateProject(client, project);

      if (result.changed) {
        stats.migratedProjects += 1;
      } else {
        stats.skippedProjects += 1;
      }

      if (result.unknownFiles.length > 0) {
        stats.untouchedUnknownFiles.push({
          projectId: project.id,
          projectName: project.name,
          files: result.unknownFiles,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stats.projectErrors.push({
        projectId: project.id,
        projectName: project.name,
        error: message,
      });
      log.error("Project migration failed", {
        projectId: project.id,
        projectName: project.name,
        err,
      });
    }
  }

  return stats;
}

export async function runMigrationFromRuntimeConfig(): Promise<MigrationStats> {
  const { databaseUrl } = await getEffectiveDatabaseConfig();
  const { client, pool } = await createPostgresDbClientFromUrl(databaseUrl);
  try {
    await runSchema(client);
    const projects = await getProjects();
    return await migrateProjectsWithClient(client, projects);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const { source } = await getEffectiveDatabaseConfig();
  const projects = await getProjects();
  if (projects.length === 0) {
    console.log("No projects found in global index. Nothing to migrate.");
    return;
  }

  console.log(`Using database URL source: ${source}`);
  console.log(`Found ${projects.length} project(s) in global index.`);

  const stats = await runMigrationFromRuntimeConfig();

  console.log("\nMigration Summary");
  console.log("-----------------");
  console.log(`Migrated projects: ${stats.migratedProjects}`);
  console.log(`Skipped projects: ${stats.skippedProjects}`);
  console.log(`Projects with errors: ${stats.projectErrors.length}`);
  console.log(`Projects with untouched unknown files: ${stats.untouchedUnknownFiles.length}`);

  if (stats.projectErrors.length > 0) {
    console.log("\nErrors:");
    for (const entry of stats.projectErrors) {
      console.log(`- ${entry.projectName} (${entry.projectId}): ${entry.error}`);
    }
  }

  if (stats.untouchedUnknownFiles.length > 0) {
    console.log("\nUntouched unknown .opensprint files:");
    for (const entry of stats.untouchedUnknownFiles) {
      console.log(`- ${entry.projectName} (${entry.projectId})`);
      for (const file of entry.files) {
        console.log(`  - ${file}`);
      }
    }
  }

  if (stats.projectErrors.length > 0) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
