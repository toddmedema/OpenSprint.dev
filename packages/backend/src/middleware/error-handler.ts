import type { Request, Response, NextFunction } from "express";
import type { ApiErrorResponse } from "@opensprint/shared";

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
  console.error(`[Error] ${err.message}`, err.stack);

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

  // Unexpected errors — in development, include the actual message for debugging
  const isDev = process.env.NODE_ENV !== "production";
  const body: ApiErrorResponse = {
    error: {
      code: "INTERNAL_ERROR",
      message: isDev && err.message ? err.message : "An unexpected error occurred",
    },
  };
  res.status(500).json(body);
}
