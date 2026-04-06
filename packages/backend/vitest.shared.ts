import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import type { Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute paths: relative setup paths can fail Vite's file loader in some CI/workspace layouts. */
export const backendSetupFile = path.resolve(__dirname, "src/__tests__/setup.ts");
export const backendGlobalSetupFile = path.resolve(__dirname, "src/__tests__/global-setup.ts");
export const backendGlobalTeardownFile = path.resolve(__dirname, "src/__tests__/global-teardown.ts");

export const backendTestInclude = [
  "src/__tests__/**/*.test.ts",
  "src/utils/__tests__/**/*.test.ts",
];
export const backendIntegrationInclude = [
  "src/__tests__/**/*.integration.test.ts",
  "src/__tests__/agent-identity.service.test.ts",
  "src/__tests__/agents-route.test.ts",
  "src/__tests__/branch-manager.test.ts",
  "src/__tests__/build-route.test.ts",
  "src/__tests__/chat-route.test.ts",
  "src/__tests__/chat-service.test.ts",
  "src/__tests__/delete-orphaned-open-questions.test.ts",
  "src/__tests__/deploy-route.test.ts",
  "src/__tests__/deploy-storage.test.ts",
  "src/__tests__/event-log.service.test.ts",
  "src/__tests__/feedback-route.test.ts",
  "src/__tests__/feedback-service.test.ts",
  "src/__tests__/git-commit-queue.test.ts",
  "src/__tests__/help-route.test.ts",
  "src/__tests__/hil-service.test.ts",
  "src/__tests__/notification.service.test.ts",
  "src/__tests__/notifications-route.test.ts",
  "src/__tests__/orphan-recovery.service.test.ts",
  "src/__tests__/plan-complexity.test.ts",
  "src/__tests__/plan-decompose-auto-review.test.ts",
  "src/__tests__/plan-backward-compat.test.ts",
  "src/__tests__/plan-route.test.ts",
  "src/__tests__/plan-status.test.ts",
  "src/__tests__/plan-suggest.test.ts",
  "src/__tests__/prd-route.test.ts",
  "src/__tests__/project-scaffold.test.ts",
  "src/__tests__/project-service.test.ts",
  "src/__tests__/projects-route.test.ts",
  "src/__tests__/run-agent-task.test.ts",
  "src/__tests__/self-improvement-change-detection.test.ts",
  "src/__tests__/session-manager.test.ts",
  "src/__tests__/settings-lifecycle.test.ts",
  "src/__tests__/task-route.test.ts",
  "src/__tests__/task-store.service.test.ts",
];

const parallelism =
  typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;

export const unitWorkers = Math.max(1, Math.ceil(parallelism * 0.75));
const envIntegrationWorkersRaw = process.env.OPENSPRINT_VITEST_INTEGRATION_MAX_WORKERS;
const envIntegrationWorkers = envIntegrationWorkersRaw
  ? Number.parseInt(envIntegrationWorkersRaw, 10)
  : Number.NaN;
export const integrationWorkers =
  Number.isFinite(envIntegrationWorkers) && envIntegrationWorkers > 0
    ? Math.floor(envIntegrationWorkers)
    : Math.min(3, Math.max(1, Math.floor(parallelism / 3) || 1));

/** Single source file for ESM imports that use the `.js` emit specifier (Node16). */
const drizzleSchemaPgSource = path.resolve(__dirname, "src/db/drizzle-schema-pg.ts");

function normalizeVitestModuleId(id: string): string {
  const withoutQuery = id.split("?")[0] ?? id;
  if (withoutQuery.startsWith("file:")) {
    try {
      return fileURLToPath(withoutQuery);
    } catch {
      return withoutQuery.replace(/\\/g, "/");
    }
  }
  return withoutQuery.replace(/\\/g, "/");
}

/**
 * Vitest/Vite sometimes surface Postgres schema imports as virtual `/src/db/drizzle-schema-pg.ts`
 * (or `file:` URLs ending the same way) during coverage, merge gates, or certain graph orders.
 * `resolve.alias` alone can miss query-suffixed ids or lose to another resolver — this hook pins
 * the module to the on-disk TS source.
 */
export function createDrizzleSchemaPgResolvePlugin(): Plugin {
  return {
    name: "opensprint-drizzle-schema-pg",
    enforce: "pre",
    resolveId(id) {
      const normalized = normalizeVitestModuleId(id);
      if (
        normalized === "/src/db/drizzle-schema-pg.ts" ||
        normalized === "/src/db/drizzle-schema-pg.js" ||
        normalized.endsWith("/src/db/drizzle-schema-pg.ts") ||
        normalized.endsWith("/src/db/drizzle-schema-pg.js")
      ) {
        return drizzleSchemaPgSource;
      }
      return undefined;
    },
  };
}

export const backendUnitExclude = [
  ...backendIntegrationInclude,
  "**/git-working-mode-branches.integration.test.ts",
  /** Run in vitest.env-route.config.ts (dedicated project + single-thread pool; avoids models mock races). */
  "**/env-route.test.ts",
];

export const backendResolveConfig = {
  alias: [
    // Pin Postgres schema module: Vite/Vitest can otherwise resolve `.js` specifiers to missing paths
    // under coverage or certain graph orders; on-disk source is only `drizzle-schema-pg.ts`.
    {
      // Match the full specifier so replacement replaces the entire id (partial matches break relative paths).
      find: /^.*[/\\]drizzle-schema-pg\.js$/,
      replacement: drizzleSchemaPgSource,
    },
    // Some transforms resolve an erroneous repo-root `/src/db/...` id during merge gates / coverage.
    { find: /^\/src\/db\/drizzle-schema-pg\.ts(\?.*)?$/, replacement: drizzleSchemaPgSource },
    { find: /^\/src\/db\/drizzle-schema-pg\.js(\?.*)?$/, replacement: drizzleSchemaPgSource },
    { find: "@opensprint/shared/types", replacement: path.resolve(__dirname, "../shared/src/types/index.ts") },
    {
      find: "@opensprint/shared/constants",
      replacement: path.resolve(__dirname, "../shared/src/constants/index.ts"),
    },
    { find: "@opensprint/shared/runtime", replacement: path.resolve(__dirname, "../shared/src/runtime/index.ts") },
    { find: "@opensprint/shared", replacement: path.resolve(__dirname, "../shared/src/index.ts") },
    { find: "pg", replacement: path.resolve(__dirname, "../../node_modules/pg/lib/index.js") },
    { find: "@google/genai", replacement: path.resolve(__dirname, "src/__tests__/mocks/google-genai.mock.ts") },
  ],
};

export const backendSsrConfig = {
  external: [
    "@google/genai",
    "@doist/todoist-api-typescript",
    "drizzle-orm",
    "drizzle-orm/node-postgres",
    "drizzle-orm/pg-core",
    "better-sqlite3",
  ],
};

export const backendCommonTestConfig = {
  globals: true,
  environment: "node" as const,
  setupFiles: [backendSetupFile],
  testTimeout: 30_000,
  teardownTimeout: 25_000,
  hookTimeout: 60_000,
};
