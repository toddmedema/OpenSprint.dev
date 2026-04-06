import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { z } from "zod";
import { validateParams, validateQuery, validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";

function assertValidationAppError(err: unknown, expectedMessage: string): void {
  expect(err).toBeInstanceOf(AppError);
  const appErr = err as AppError;
  expect(appErr.statusCode).toBe(400);
  expect(appErr.code).toBe(ErrorCodes.VALIDATION_ERROR);
  expect(appErr.message).toBe(expectedMessage);
}

describe("validate middleware", () => {
  let mockRes: Response;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRes = {} as Response;
    next = vi.fn();
  });

  describe("validateParams", () => {
    const schema = z.object({ projectId: z.uuid() });

    it("calls next and assigns parsed params on success", () => {
      const id = "550e8400-e29b-41d4-a716-446655440000";
      const req = { params: { projectId: id } } as unknown as Request;
      validateParams(schema)(req, mockRes, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.params).toEqual({ projectId: id });
    });

    it("calls next(AppError) with 400 VALIDATION_ERROR and first Zod issue message on failure", () => {
      const req = { params: { projectId: "not-a-uuid" } } as unknown as Request;
      const parsed = schema.safeParse(req.params);
      expect(parsed.success).toBe(false);
      const firstMessage = parsed.error!.issues[0]!.message;

      validateParams(schema)(req, mockRes, next);
      expect(next).toHaveBeenCalledTimes(1);
      assertValidationAppError(next.mock.calls[0]![0], firstMessage);
    });

    it("uses only the first issue message when multiple fields fail", () => {
      const multi = z.object({
        a: z.string().min(5, "a too short"),
        b: z.string().min(5, "b too short"),
      });
      const req = { params: { a: "x", b: "y" } } as unknown as Request;
      const parsed = multi.safeParse(req.params);
      expect(parsed.success).toBe(false);
      const firstOnly = parsed.error!.issues[0]!.message;

      validateParams(multi)(req, mockRes, next);
      expect(next).toHaveBeenCalledTimes(1);
      assertValidationAppError(next.mock.calls[0]![0], firstOnly);
    });
  });

  describe("validateQuery", () => {
    const schema = z.object({
      page: z.coerce.number().int().positive(),
    });

    it("calls next and assigns parsed query on success", () => {
      const req = { query: { page: "3" } } as unknown as Request;
      validateQuery(schema)(req, mockRes, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.query).toEqual({ page: 3 });
    });

    it("calls next(AppError) with 400 VALIDATION_ERROR and first Zod issue message on failure", () => {
      const req = { query: { page: "0" } } as unknown as Request;
      const parsed = schema.safeParse(req.query);
      expect(parsed.success).toBe(false);
      const firstMessage = parsed.error!.issues[0]!.message;

      validateQuery(schema)(req, mockRes, next);
      expect(next).toHaveBeenCalledTimes(1);
      assertValidationAppError(next.mock.calls[0]![0], firstMessage);
    });
  });

  describe("validateBody", () => {
    const schema = z.object({
      name: z.string().min(1, "name required"),
      count: z.number().int(),
    });

    it("calls next and assigns parsed body on success", () => {
      const req = { body: { name: "x", count: 2 } } as unknown as Request;
      validateBody(schema)(req, mockRes, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.body).toEqual({ name: "x", count: 2 });
    });

    it("calls next(AppError) with 400 VALIDATION_ERROR and first Zod issue message on failure", () => {
      const req = { body: { name: "", count: 1.5 } } as unknown as Request;
      const parsed = schema.safeParse(req.body);
      expect(parsed.success).toBe(false);
      const firstMessage = parsed.error!.issues[0]!.message;

      validateBody(schema)(req, mockRes, next);
      expect(next).toHaveBeenCalledTimes(1);
      assertValidationAppError(next.mock.calls[0]![0], firstMessage);
    });
  });
});
