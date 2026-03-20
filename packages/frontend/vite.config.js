import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
    plugins: [react()],
    build: {
        manifest: true,
        // The markdown editor bundle is lazy-loaded but legitimately large.
        // Keep warning noise low while preserving the existing chunk strategy.
        chunkSizeWarningLimit: 1700,
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@opensprint/shared": path.resolve(__dirname, "../shared/src/index.ts"),
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
