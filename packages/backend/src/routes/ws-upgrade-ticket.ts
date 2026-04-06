import { Router } from "express";
import { wrapAsync } from "../middleware/wrap-async.js";
import { issueWebSocketUpgradeTicket } from "../services/websocket-upgrade-ticket.service.js";

export const wsUpgradeTicketRouter = Router();

wsUpgradeTicketRouter.post(
  "/",
  wrapAsync(async (_req, res) => {
    const ticket = issueWebSocketUpgradeTicket();
    res.json({ data: { ticket } });
  })
);
