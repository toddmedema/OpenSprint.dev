import { Router, Request } from "express";
import type {
  ApiResponse,
  HelpChatRequest,
  HelpChatResponse,
  HelpChatHistory,
} from "@opensprint/shared";
import { HelpChatService } from "../services/help-chat.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("help-route");
export const helpChatService = new HelpChatService();

export const helpRouter = Router();

// GET /help/chat/history — Load persisted Help chat messages (projectId query = per-project; omit = homepage)
helpRouter.get("/chat/history", async (req: Request, res, next) => {
  try {
    const projectId = (req.query.projectId as string)?.trim() || null;
    log.info("GET /help/chat/history", { projectId: projectId ?? "homepage" });
    const history = await helpChatService.getHistory(projectId);
    const result: ApiResponse<HelpChatHistory> = { data: history };
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /help/chat — Ask a Question (ask-only agent, no state changes)
helpRouter.post("/chat", async (req: Request, res, next) => {
  try {
    const body = req.body as HelpChatRequest;
    log.info("POST /help/chat", {
      projectId: body.projectId ?? "homepage",
      messageLen: body.message?.length ?? 0,
    });
    const response = await helpChatService.sendMessage(body);
    const result: ApiResponse<HelpChatResponse> = { data: response };
    res.json(result);
  } catch (err) {
    next(err);
  }
});
