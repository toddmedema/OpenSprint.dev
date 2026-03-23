import { z } from "zod";

export const planIdParamSchema = z.object({
  projectId: z.string().min(1),
  planId: z.string().min(1),
});

export const planVersionParamsSchema = z.object({
  projectId: z.string().min(1),
  planId: z.string().min(1),
  versionNumber: z.string().min(1),
});

export const plansGenerateBodySchema = z.object({
  description: z
    .string()
    .min(1, { message: "description is required" })
    .refine((s) => s.trim().length > 0, { message: "description is required" }),
});

/** POST /plans — create plan; body is plan payload (title, content, etc.) */
export const createPlanBodySchema = z.record(z.string(), z.unknown());

export const planExecuteBodySchema = z
  .object({
    prerequisitePlanIds: z.array(z.string()).optional(),
    version_number: z.number().int().positive().optional(),
  })
  .optional()
  .default({});

export const planReexecuteBodySchema = z
  .object({
    version_number: z.number().int().positive().optional(),
  })
  .optional()
  .default({});

export const planExecuteBatchBodySchema = z.object({
  items: z
    .array(
      z.object({
        planId: z.string().min(1),
        prerequisitePlanIds: z.array(z.string()).optional(),
        version_number: z.number().int().positive().optional(),
      })
    )
    .min(1),
});

export const planExecuteBatchParamsSchema = z.object({
  projectId: z.string().min(1),
  batchId: z.string().min(1),
});
