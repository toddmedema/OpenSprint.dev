import { Router, Request } from "express";
import Anthropic from "@anthropic-ai/sdk";
import type { ApiResponse } from "@opensprint/shared";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import * as modelListCache from "../services/model-list-cache.js";

export interface ModelOption {
  id: string;
  displayName: string;
}

export const modelsRouter = Router();

const CURSOR_MODELS_URL = "https://api.cursor.com/v0/models";

/** In-flight fetches per provider to coalesce concurrent requests (avoids rate limits). */
const inFlightFetches = new Map<string, Promise<ModelOption[]>>();

/** Clear in-flight fetches (for tests). */
export function clearInFlightFetches(): void {
  inFlightFetches.clear();
}

async function fetchClaudeModels(apiKey: string): Promise<ModelOption[]> {
  const client = new Anthropic({ apiKey });
  const models: ModelOption[] = [];
  for await (const model of client.models.list({ limit: 100 })) {
    models.push({
      id: model.id,
      displayName: model.display_name,
    });
  }
  return models;
}

async function fetchCursorModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch(CURSOR_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const hint =
      response.status === 401
        ? " Check that CURSOR_API_KEY in .env is valid. Get a key from Cursor → Settings → Integrations → User API Keys."
        : response.status === 403
          ? " Your API key may not have access to models."
          : response.status === 429
            ? " Cursor API rate limit hit. The app caches model lists for 30 minutes; try again shortly."
            : "";
    throw new AppError(
      response.status >= 500 ? 502 : response.status,
      ErrorCodes.CURSOR_API_ERROR,
      `Cursor API error ${response.status}: ${text}${hint}`,
      {
        status: response.status,
        responsePreview: text.slice(0, 200),
      }
    );
  }

  const body = (await response.json()) as { models?: string[] };
  return (body.models ?? []).map((id) => ({
    id,
    displayName: id,
  }));
}

/**
 * Fetch models for a provider with request coalescing.
 * Concurrent requests for the same provider share a single API call to avoid rate limits.
 */
async function getModelsWithCoalescing(
  provider: "claude" | "cursor",
  fetchFn: () => Promise<ModelOption[]>
): Promise<ModelOption[]> {
  const cached = modelListCache.get<ModelOption[]>(provider);
  if (cached !== undefined) return cached;

  let promise = inFlightFetches.get(provider);
  if (!promise) {
    promise = fetchFn().then(
      (models) => {
        modelListCache.set(provider, models);
        inFlightFetches.delete(provider);
        return models;
      },
      (err) => {
        inFlightFetches.delete(provider);
        throw err;
      }
    );
    inFlightFetches.set(provider, promise);
  }
  return promise;
}

const CLAUDE_CLI_DEFAULT_MODELS: ModelOption[] = [
  { id: "claude-sonnet-4-20250514", displayName: "Claude Sonnet 4" },
  { id: "claude-opus-4-20250514", displayName: "Claude Opus 4" },
  { id: "claude-haiku-35-20241022", displayName: "Claude 3.5 Haiku" },
];

// GET /models?provider=claude|claude-cli|cursor — List available models for the given provider
modelsRouter.get("/", async (req: Request, res, next) => {
  try {
    const provider = (req.query.provider as string) || "claude";

    if (provider === "claude") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        res.json({ data: [] } as ApiResponse<ModelOption[]>);
        return;
      }

      const models = await getModelsWithCoalescing("claude", () => fetchClaudeModels(apiKey));
      res.json({ data: models } as ApiResponse<ModelOption[]>);
      return;
    }

    if (provider === "claude-cli") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const models = await getModelsWithCoalescing("claude", () => fetchClaudeModels(apiKey));
        res.json({ data: models } as ApiResponse<ModelOption[]>);
      } else {
        res.json({ data: CLAUDE_CLI_DEFAULT_MODELS } as ApiResponse<ModelOption[]>);
      }
      return;
    }

    if (provider === "cursor") {
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) {
        res.json({ data: [] } as ApiResponse<ModelOption[]>);
        return;
      }

      const models = await getModelsWithCoalescing("cursor", () => fetchCursorModels(apiKey));
      res.json({ data: models } as ApiResponse<ModelOption[]>);
      return;
    }

    res.json({ data: [] } as ApiResponse<ModelOption[]>);
  } catch (err) {
    next(err);
  }
});
