import { defineProject } from "vitest/config";
import {
  backendCommonTestConfig,
  createDrizzleSchemaPgResolvePlugin,
  backendResolveConfig,
  backendSsrConfig,
  backendTestInclude,
  backendUnitExclude,
} from "./vitest.shared.js";

export default defineProject({
  plugins: [createDrizzleSchemaPgResolvePlugin()],
  resolve: backendResolveConfig,
  ssr: backendSsrConfig,
  test: {
    ...backendCommonTestConfig,
    name: "backend-unit",
    include: backendTestInclude,
    exclude: backendUnitExclude,
    env: { OPENSPRINT_VITEST_SCHEMA_SCOPE: "unit" },
    pool: "forks",
    minWorkers: 1,
    /**
     * Single worker: only one backend unit test file runs at a time globally. Parallel workers
     * + supertest was still producing rare 401/socket/parse flakes (different processes contending
     * on the same host resources).
     */
    maxWorkers: 1,
    fileParallelism: false,
  },
});
