import type { Request, Response, NextFunction } from "express";
import { AppError } from "./error-handler.js";
import { ErrorCodes } from "./error-codes.js";
import { requestIsAuthenticated } from "../services/local-session-auth.service.js";

/**
 * Guards local-only API routes.
 *
 * **All methods** require a valid `Authorization: Bearer <token>`.
 * Accepting a localhost Origin/Referer alone for safe methods was removed to
 * prevent data exfiltration by other local web apps via the victim's browser.
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
