import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { getManualChunkForModuleId } from "./vite.manualChunks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The frontend workspace currently resolves Vite types from two locations during `tsc -b`
// (workspace-local Vite for the CLI and hoisted Vite via Vitest). The runtime build uses the
// local Vite binary successfully; this cast prevents the config typecheck from comparing the
// two incompatible plugin type trees.
const reactPlugin = react() as unknown as PluginOption;

export default defineConfig({
  plugins: [reactPlugin],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return getManualChunkForModuleId(id);
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@opensprint/shared": path.resolve(__dirname, "../shared/src/index.ts"),
      "@opensprint/shared/types": path.resolve(__dirname, "../shared/src/types/index.ts"),
      "@opensprint/shared/constants": path.resolve(__dirname, "../shared/src/constants/index.ts"),
      "@opensprint/shared/runtime": path.resolve(__dirname, "../shared/src/runtime/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3100",
        ws: true,
      },
    },
  },
});
