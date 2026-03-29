import { defineProject } from "vitest/config";
import {
  backendCommonTestConfig,
  backendIntegrationInclude,
  backendResolveConfig,
  backendSsrConfig,
  integrationWorkers,
} from "./vitest.shared.js";

export default defineProject({
  resolve: backendResolveConfig,
  ssr: backendSsrConfig,
  test: {
    ...backendCommonTestConfig,
    name: "backend-integration",
    include: backendIntegrationInclude,
    pool: "forks",
    minWorkers: 1,
    maxWorkers: integrationWorkers,
    globalSetup: ["./src/__tests__/global-setup.ts"],
    globalTeardown: ["./src/__tests__/global-teardown.ts"],
  },
});
