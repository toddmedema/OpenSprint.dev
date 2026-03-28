import { z } from "zod";
import { projectIdParamSchema } from "./request-common.js";

export const todoistOAuthCallbackQuerySchema = z.object({
  code: z.string().min(1, { message: "code is required" }),
  state: z.string().min(1, { message: "state is required" }),
});

export const todoistProjectSelectionBodySchema = z.object({
  todoistProjectId: z.string().min(1, { message: "todoistProjectId is required" }),
});

export { projectIdParamSchema as integrationProjectIdParamsSchema };

export type TodoistOAuthCallbackQuery = z.infer<typeof todoistOAuthCallbackQuerySchema>;
export type TodoistProjectSelectionBody = z.infer<typeof todoistProjectSelectionBodySchema>;
export type IntegrationProjectIdParams = z.infer<typeof projectIdParamSchema>;
