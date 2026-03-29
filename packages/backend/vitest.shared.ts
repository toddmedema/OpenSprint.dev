import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
export const integrationWorkers = Math.min(3, Math.max(1, Math.floor(parallelism / 3) || 1));

export const backendUnitExclude = [
  ...backendIntegrationInclude,
  "**/git-working-mode-branches.integration.test.ts",
  /** Run in vitest.env-route.config.ts (dedicated project + single-thread pool; avoids models mock races). */
  "**/env-route.test.ts",
];

export const backendResolveConfig = {
  alias: {
    "@opensprint/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    "@opensprint/shared/types": path.resolve(__dirname, "../shared/src/types/index.ts"),
    "@opensprint/shared/constants": path.resolve(__dirname, "../shared/src/constants/index.ts"),
    "@opensprint/shared/runtime": path.resolve(__dirname, "../shared/src/runtime/index.ts"),
    pg: path.resolve(__dirname, "../../node_modules/pg/lib/index.js"),
    "@google/genai": path.resolve(__dirname, "src/__tests__/mocks/google-genai.mock.ts"),
  },
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
  setupFiles: ["./src/__tests__/setup.ts"],
  testTimeout: 30_000,
  teardownTimeout: 25_000,
  hookTimeout: 60_000,
};
