import type { Request, Response, NextFunction } from "express";
import type { ApiErrorResponse } from "@opensprint/shared";
import { createLogger } from "../utils/logger.js";
import { ErrorCodes } from "./error-codes.js";

const log = createLogger("error-handler");

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  const requestId = _req.requestId;
  if (err instanceof AppError) {
    if (err.code === "DATABASE_UNAVAILABLE") {
      res.setHeader("Retry-After", "5");
    }
    // 4xx are expected client errors (e.g. not found); log at debug to avoid noise.
    // Optional local model servers (LM Studio / Ollama) often return 502 when not running;
    // that is an expected outcome for model-list probes, not an application fault.
    const localModelProbeUnreachable =
      err.statusCode === 502 &&
      (err.code === ErrorCodes.LM_STUDIO_UNREACHABLE || err.code === ErrorCodes.OLLAMA_UNREACHABLE);
    if (err.statusCode < 500 || localModelProbeUnreachable) {
      log.debug("Request client error", {
        requestId,
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
      });
    } else {
      log.error("Request error", { requestId, message: err.message, stack: err.stack });
    }
    const body: ApiErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // Unexpected errors
  log.error("Request error", { requestId, message: err.message, stack: err.stack });
  const isDev = process.env.NODE_ENV !== "production";
  const body: ApiErrorResponse = {
    error: {
      code: "INTERNAL_ERROR",
      message: isDev && err.message ? err.message : "An unexpected error occurred",
      details: isDev && err.stack ? { stack: err.stack } : undefined,
    },
  };
  res.status(500).json(body);
}
