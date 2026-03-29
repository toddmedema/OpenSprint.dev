import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared/vitest.config.ts",
  "packages/backend/vitest.unit.config.ts",
  "packages/backend/vitest.env-route.config.ts",
  "packages/backend/vitest.integration.config.ts",
  "packages/frontend/vitest.unit.config.ts",
  "packages/frontend/vitest.flow.config.ts",
  "packages/electron/vitest.config.ts",
]);
