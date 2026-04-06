import { defineProject } from "vitest/config";
import {
  backendCommonTestConfig,
  createDrizzleSchemaPgResolvePlugin,
  backendResolveConfig,
  backendSsrConfig,
} from "./vitest.shared.js";

/**
 * Isolated single-worker project for env-route tests.
 *
 * env-route.test.ts uses vi.mock for node:child_process and ../routes/models.js.
 * Under parallel workers the real models.js (Anthropic/OpenAI SDK init, network
 * calls) can be evaluated before the mock is installed, causing intermittent
 * failures. Running in its own project with maxWorkers 1, fileParallelism off,
 * and per-file isolation guarantees the mocks are always applied first.
 *
 * See also: backendUnitExclude in vitest.shared.ts which removes this file from
 * the main backend-unit project.
 */
export default defineProject({
  plugins: [createDrizzleSchemaPgResolvePlugin()],
  resolve: backendResolveConfig,
  ssr: backendSsrConfig,
  test: {
    ...backendCommonTestConfig,
    name: "backend-env-route",
    include: ["src/__tests__/env-route.test.ts"],
    env: { OPENSPRINT_VITEST_SCHEMA_SCOPE: "env" },
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    isolate: true,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
