import path from "path";
import { config } from "dotenv";
import { createServer } from "http";
import { createApp } from "./app.js";

// Load .env from monorepo root (must run before any code that reads process.env)
config({ path: path.resolve(process.cwd(), ".env") });
config({ path: path.resolve(process.cwd(), "../.env") });
config({ path: path.resolve(process.cwd(), "../../.env") });
import { setupWebSocket, closeWebSocket } from "./websocket/index.js";
import { DEFAULT_API_PORT } from "@opensprint/shared";

const port = parseInt(process.env.PORT || String(DEFAULT_API_PORT), 10);

const app = createApp();
const server = createServer(app);

// Attach WebSocket server
setupWebSocket(server);

server.listen(port, () => {
  console.log(`OpenSprint backend listening on http://localhost:${port}`);
  console.log(`WebSocket server ready on ws://localhost:${port}/ws`);
});

// Graceful shutdown
const shutdown = () => {
  console.log("\nShutting down...");
  closeWebSocket();
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 3000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
