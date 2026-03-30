import type { Request, Response, NextFunction } from "express";
import { AppError } from "./error-handler.js";
import { ErrorCodes } from "./error-codes.js";
import { requestIsAuthenticated } from "../services/local-session-auth.service.js";

/**
 * Guards local-only API routes.
 *
 * - **Mutating methods** (POST/PUT/DELETE/PATCH) require a valid
 *   `Authorization: Bearer <token>` to prevent CSRF from other localhost apps.
 * - **Safe methods** (GET/HEAD/OPTIONS) accept either the bearer token or a
 *   trusted localhost Origin / Referer.
 */
export function requireLocalSessionAuth(req: Request, _res: Response, next: NextFunction): void {
  if (
    requestIsAuthenticated(
      req.method,
      req.headers.authorization,
      req.headers.origin,
      req.headers.referer
    )
  ) {
    next();
    return;
  }
  next(
    new AppError(
      403,
      ErrorCodes.LOCAL_SESSION_AUTH_REQUIRED,
      "This endpoint requires Authorization: Bearer with the current server session token."
    )
  );
}
