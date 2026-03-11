import type { Request, Response, NextFunction } from "express";

/**
 * Async route handler: receives req, res, next and may return a Promise.
 * Generic Req allows typed params (e.g. Request<{ projectId: string }>).
 */
export type AsyncRequestHandler<Req = Request> = (
  req: Req,
  res: Response,
  next: NextFunction
) => void | Promise<void | unknown>;

/**
 * Wraps an async route handler so that thrown errors and rejected promises
 * are forwarded to Express's error handling via `next(err)`.
 * Eliminates the need for try/catch in every handler.
 */
export function wrapAsync<Req extends Request = Request>(fn: AsyncRequestHandler<Req>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve()
      .then(() => fn(req as Req, res, next))
      .catch(next);
  };
}
