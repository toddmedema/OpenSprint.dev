import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../middleware/error-handler.js";
import { errorHandler } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import type { Request, Response } from "express";

describe("AppError", () => {
  it("should create error with statusCode, code, message, and optional details", () => {
    const err = new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, "Project not found", { projectId: "p1" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe(ErrorCodes.PROJECT_NOT_FOUND);
    expect(err.message).toBe("Project not found");
    expect(err.details).toEqual({ projectId: "p1" });
    expect(err.name).toBe("AppError");
  });

  it("should work without details parameter", () => {
    const err = new AppError(400, ErrorCodes.INVALID_INPUT, "Invalid input");
    expect(err.details).toBeUndefined();
  });
});

describe("ErrorCodes", () => {
  it("should export all expected error codes", () => {
    expect(ErrorCodes.INVALID_INPUT).toBe("INVALID_INPUT");
    expect(ErrorCodes.PROJECT_NOT_FOUND).toBe("PROJECT_NOT_FOUND");
    expect(ErrorCodes.PLAN_NOT_FOUND).toBe("PLAN_NOT_FOUND");
    expect(ErrorCodes.BEADS_COMMAND_FAILED).toBe("BEADS_COMMAND_FAILED");
    expect(ErrorCodes.AGENT_INVOKE_FAILED).toBe("AGENT_INVOKE_FAILED");
    expect(ErrorCodes.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
  });
});

describe("errorHandler", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonSpy: ReturnType<typeof vi.fn>;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonSpy = vi.fn();
    const resWithJson = { json: jsonSpy };
    statusSpy = vi.fn().mockReturnValue(resWithJson);
    mockReq = {};
    mockRes = { status: statusSpy, json: jsonSpy, ...resWithJson };
  });

  it("should handle AppError with correct status and body", () => {
    const err = new AppError(404, ErrorCodes.PLAN_NOT_FOUND, "Plan not found", { planId: "p1" });
    errorHandler(err, mockReq as Request, mockRes as Response, () => {});

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(jsonSpy).toHaveBeenCalledWith({
      error: {
        code: ErrorCodes.PLAN_NOT_FOUND,
        message: "Plan not found",
        details: { planId: "p1" },
      },
    });
  });

  it("should handle generic Error with 500 and INTERNAL_ERROR", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const err = new Error("Unexpected failure");
    errorHandler(err, mockReq as Request, mockRes as Response, () => {});

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(jsonSpy).toHaveBeenCalledWith({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        details: undefined,
      },
    });

    process.env.NODE_ENV = originalEnv;
  });

  it("should include stack in details for generic Error in development", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const err = new Error("Dev error");
    errorHandler(err, mockReq as Request, mockRes as Response, () => {});

    expect(statusSpy).toHaveBeenCalledWith(500);
    const call = jsonSpy.mock.calls[0][0];
    expect(call.error.code).toBe("INTERNAL_ERROR");
    expect(call.error.message).toBe("Dev error");
    expect(call.error.details).toBeDefined();
    expect(call.error.details).toHaveProperty("stack");
    expect(typeof call.error.details.stack).toBe("string");

    process.env.NODE_ENV = originalEnv;
  });
});
