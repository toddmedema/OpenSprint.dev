import type { Request, Response, NextFunction } from "express";
import type { ApiErrorResponse } from "@opensprint/shared";
import { createLogger } from "../utils/logger.js";

const log = createLogger("error-handler");

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  log.error("Request error", { message: err.message, stack: err.stack });

  if (err instanceof AppError) {
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

  // Unexpected errors — in development, include message and stack for debugging
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
