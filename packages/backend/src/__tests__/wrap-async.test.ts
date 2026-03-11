import { describe, it, expect, vi } from "vitest";
import { wrapAsync } from "../middleware/wrap-async.js";
import type { Request, Response, NextFunction } from "express";

describe("wrapAsync", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {};
    mockRes = { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() };
    mockNext = vi.fn();
  });

  it("forwards successful async handler result", async () => {
    const handler = wrapAsync(async (_req, res) => {
      (res as Response).json({ data: "ok" });
    });
    handler(mockReq as Request, mockRes as Response, mockNext);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockRes.json).toHaveBeenCalledWith({ data: "ok" });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("forwards rejected promise to next(err)", async () => {
    const err = new Error("async failure");
    const handler = wrapAsync(async () => {
      await Promise.reject(err);
    });
    handler(mockReq as Request, mockRes as Response, mockNext);

    await new Promise((r) => setTimeout(r, 10));
    expect(mockNext).toHaveBeenCalledWith(err);
  });

  it("forwards synchronous throw to next(err)", async () => {
    const err = new Error("sync failure");
    const handler = wrapAsync(async () => {
      throw err;
    });
    handler(mockReq as Request, mockRes as Response, mockNext);

    await new Promise((r) => setTimeout(r, 10));
    expect(mockNext).toHaveBeenCalledWith(err);
  });

  it("handles handler that returns void (no explicit return)", async () => {
    const handler = wrapAsync(async (_req, res) => {
      (res as Response).status(204).send();
    });
    handler(mockReq as Request, mockRes as Response, mockNext);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockRes.send).toHaveBeenCalled();
    expect(mockNext).not.toHaveBeenCalled();
  });
});
