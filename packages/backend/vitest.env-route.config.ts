import { defineProject } from "vitest/config";
import {
  backendCommonTestConfig,
  backendResolveConfig,
  backendSsrConfig,
} from "./vitest.shared.js";

/** Isolated project: stubbed models.js + single-fork pool avoids mock races under CI parallelism. */
export default defineProject({
  resolve: backendResolveConfig,
  ssr: backendSsrConfig,
  test: {
    ...backendCommonTestConfig,
    name: "backend-env-route",
    include: ["src/__tests__/env-route.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
