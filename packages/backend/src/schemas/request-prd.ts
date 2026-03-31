import { z } from "zod";

const includeContentSchema = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === undefined || v === "true" || v === "1");

export const prdDiffQuerySchema = z.object({
  fromVersion: z.coerce.number().int().nonnegative(),
  toVersion: z.string().optional(),
  includeContent: includeContentSchema,
});

export const prdProposedDiffQuerySchema = z.object({
  requestId: z.string().min(1, { message: "requestId is required" }),
  includeContent: includeContentSchema,
});

export const prdSectionParamsSchema = z.object({
  projectId: z.string().min(1),
  section: z.string().min(1),
});

export const prdSectionPutBodySchema = z.object({
  content: z.string(),
  source: z.string().optional(),
});
