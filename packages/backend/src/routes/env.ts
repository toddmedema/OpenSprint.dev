import { Router, Request } from "express";
import path from "path";
import { readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ApiResponse } from "@opensprint/shared";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { createLogger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("env");

const ALLOWED_KEYS = ["ANTHROPIC_API_KEY", "CURSOR_API_KEY"] as const;

/** Override for tests when process.chdir is not available (e.g. Vitest workers). Set to null in production. */
let envPathForTesting: string | null = null;
export function setEnvPathForTesting(path: string | null): void {
  envPathForTesting = path;
}

async function getEnvPath(): Promise<string> {
  if (envPathForTesting !== null) return envPathForTesting;
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, ".env"),
    path.resolve(cwd, "../.env"),
    path.resolve(cwd, "../../.env"),
  ];
  for (const p of candidates) {
    try {
      await access(p, constants.R_OK);
      return p;
    } catch (_err) {
      log.debug("Env path not readable, skipping", { path: p });
      continue;
    }
  }
  return path.resolve(cwd, "../../.env");
}

function parseEnv(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

function serializeEnv(map: Map<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of map) {
    const escaped =
      value.includes(" ") || value.includes("#") ? `"${value.replace(/"/g, '\\"')}"` : value;
    lines.push(`${key}=${escaped}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

export const envRouter = Router();

/** Check whether the `claude` CLI binary is on $PATH */
async function isClaudeCliAvailable(): Promise<boolean> {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    await execFileAsync(cmd, ["claude"], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// GET /env/keys — Check which API keys / CLIs are configured (never returns key values)
envRouter.get("/keys", async (_req, res, next) => {
  try {
    const anthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
    const cursor = Boolean(process.env.CURSOR_API_KEY?.trim());
    const claudeCli = await isClaudeCliAvailable();
    res.json({
      data: { anthropic, cursor, claudeCli },
    } as ApiResponse<{ anthropic: boolean; cursor: boolean; claudeCli: boolean }>);
  } catch (err) {
    next(err);
  }
});

// POST /env/keys — Save an API key to .env (creates file if missing)
envRouter.post("/keys", async (req: Request, res, next) => {
  try {
    const { key, value } = req.body as { key?: string; value?: string };
    if (!key || typeof value !== "string") {
      throw new AppError(400, ErrorCodes.INVALID_INPUT, "key and value are required");
    }
    if (!ALLOWED_KEYS.includes(key as (typeof ALLOWED_KEYS)[number])) {
      throw new AppError(
        400,
        ErrorCodes.INVALID_KEY,
        `Only ${ALLOWED_KEYS.join(", ")} can be set via this endpoint`
      );
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new AppError(400, ErrorCodes.INVALID_INPUT, "value cannot be empty");
    }

    const envPath = await getEnvPath();
    let content = "";
    try {
      content = await readFile(envPath, "utf-8");
    } catch {
      log.debug("No existing .env, will create or overwrite", { envPath });
      content = "";
    }

    const map = parseEnv(content);
    map.set(key, trimmed);
    const output = serializeEnv(map);

    try {
      await writeFile(envPath, output, "utf-8");
    } catch (writeErr) {
      const msg = getErrorMessage(writeErr);
      const code = (writeErr as NodeJS.ErrnoException)?.code;
      const hint =
        code === "EACCES"
          ? " Permission denied. Ensure the .env file is writable."
          : code === "EROFS"
            ? " Read-only filesystem. Cannot write .env."
            : "";
      throw new AppError(
        500,
        ErrorCodes.ENV_WRITE_FAILED,
        `Failed to save API key to .env: ${msg}${hint}`,
        { cause: msg }
      );
    }

    process.env[key] = trimmed;

    res.json({ data: { saved: true } } as ApiResponse<{ saved: boolean }>);
  } catch (err) {
    next(err);
  }
});
