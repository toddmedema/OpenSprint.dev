import { Router, Request } from "express";
import Anthropic from "@anthropic-ai/sdk";
import type { ApiResponse } from "@opensprint/shared";

export interface ModelOption {
  id: string;
  displayName: string;
}

export const modelsRouter = Router();

const CURSOR_MODELS_URL = "https://api.cursor.com/v0/models";

// GET /models?provider=claude|cursor — List available models for the given provider
modelsRouter.get("/", async (req: Request, res, next) => {
  try {
    const provider = (req.query.provider as string) || "claude";

    if (provider === "claude") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        res.json({ data: [] } as ApiResponse<ModelOption[]>);
        return;
      }

      const client = new Anthropic({ apiKey });
      const models: ModelOption[] = [];

      for await (const model of client.models.list({ limit: 100 })) {
        models.push({
          id: model.id,
          displayName: model.display_name,
        });
      }

      res.json({ data: models } as ApiResponse<ModelOption[]>);
      return;
    }

    if (provider === "cursor") {
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) {
        res.json({ data: [] } as ApiResponse<ModelOption[]>);
        return;
      }

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
              : "";
        throw new Error(`Cursor API error ${response.status}: ${text}${hint}`);
      }

      const body = (await response.json()) as { models?: string[] };
      const models: ModelOption[] = (body.models ?? []).map((id) => ({
        id,
        displayName: id,
      }));

      res.json({ data: models } as ApiResponse<ModelOption[]>);
      return;
    }

    res.json({ data: [] } as ApiResponse<ModelOption[]>);
  } catch (err) {
    next(err);
  }
});
