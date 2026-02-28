import { Router, Request } from "express";
import type { ApiResponse } from "@opensprint/shared";
import { maskDatabaseUrl, validateDatabaseUrl, DEFAULT_DATABASE_URL } from "@opensprint/shared";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import {
  getGlobalSettings,
  updateGlobalSettings,
} from "../services/global-settings.service.js";

export const globalSettingsRouter = Router();

/** Response shape for GET /global-settings */
export interface GlobalSettingsResponse {
  databaseUrl: string;
}

// GET /global-settings — Returns databaseUrl masked (host/port visible, password redacted).
globalSettingsRouter.get("/", async (_req, res, next) => {
  try {
    const settings = await getGlobalSettings();
    const effectiveUrl = settings.databaseUrl ?? DEFAULT_DATABASE_URL;
    const masked = maskDatabaseUrl(effectiveUrl);

    res.json({
      data: { databaseUrl: masked },
    } as ApiResponse<GlobalSettingsResponse>);
  } catch (err) {
    next(err);
  }
});

// PUT /global-settings — Accepts databaseUrl, validates format, writes to global-settings.json.
globalSettingsRouter.put("/", async (req: Request, res, next) => {
  try {
    const body = req.body as { databaseUrl?: string };
    const updates: { databaseUrl?: string } = {};

    if (body.databaseUrl !== undefined) {
      if (typeof body.databaseUrl !== "string") {
        throw new AppError(
          400,
          ErrorCodes.INVALID_INPUT,
          "databaseUrl must be a string"
        );
      }
      const trimmed = body.databaseUrl.trim();
      if (!trimmed) {
        throw new AppError(
          400,
          ErrorCodes.INVALID_INPUT,
          "databaseUrl cannot be empty"
        );
      }
      try {
        updates.databaseUrl = validateDatabaseUrl(trimmed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invalid database URL";
        throw new AppError(400, ErrorCodes.INVALID_INPUT, msg);
      }
    }

    if (Object.keys(updates).length === 0) {
      const current = await getGlobalSettings();
      const effectiveUrl = current.databaseUrl ?? DEFAULT_DATABASE_URL;
      return res.json({
        data: { databaseUrl: maskDatabaseUrl(effectiveUrl) },
      } as ApiResponse<GlobalSettingsResponse>);
    }

    const updated = await updateGlobalSettings(updates);
    const effectiveUrl = updated.databaseUrl ?? DEFAULT_DATABASE_URL;

    res.json({
      data: { databaseUrl: maskDatabaseUrl(effectiveUrl) },
    } as ApiResponse<GlobalSettingsResponse>);
  } catch (err) {
    next(err);
  }
});
