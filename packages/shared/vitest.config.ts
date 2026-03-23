import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@opensprint/shared": path.resolve(__dirname, "src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    pool: "threads",
    poolOptions: {
      threads: { minThreads: 1, maxThreads: 2 },
    },
    testTimeout: 30_000,
    teardownTimeout: 10_000,
    coverage: {
      all: true,
      provider: "v8",
      excludeAfterRemap: true,
      include: ["src/**/*.{ts,js}"],
      exclude: [
        "src/__tests__/**",
        "src/**/*.d.ts",
        "src/index.ts",
        "src/types/api.ts",
        "src/types/agent.ts",
        "src/types/conversation.ts",
        "src/types/deploy.ts",
        "src/types/execute-diagnostics.ts",
        "src/types/failure-metrics.ts",
        "src/types/feedback.ts",
        "src/types/notification.ts",
        "src/types/prd.ts",
        "src/types/project.ts",
        "src/types/task.ts",
        "src/types/websocket.ts",
        "src/types/workflow.ts",
      ],
      thresholds: {
        statements: 94,
        branches: 85,
        functions: 89,
        lines: 94,
      },
    },
  },
});
