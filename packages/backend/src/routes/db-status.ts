import { Router } from "express";
import type { ApiResponse } from "@opensprint/shared";
import { taskStore } from "../services/task-store.service.js";

export const dbStatusRouter = Router();

/**
 * GET /db-status — Check PostgreSQL connectivity.
 * Returns { data: { ok: true } } when connected, or { data: { ok: false, message } } when not.
 * Used by the homepage to show an error banner when the backend cannot connect.
 */
dbStatusRouter.get("/", async (_req, res) => {
  try {
    const result = await taskStore.checkConnection();
    res.json({ data: result } as ApiResponse<typeof result>);
  } catch {
    res.json({
      data: {
        ok: false,
        message: "Server is unable to connect to PostgreSQL database.",
      },
    } as ApiResponse<{ ok: false; message: string }>);
  }
});
