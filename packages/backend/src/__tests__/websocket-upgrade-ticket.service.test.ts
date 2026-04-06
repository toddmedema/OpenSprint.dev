import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  issueWebSocketUpgradeTicket,
  consumeWebSocketUpgradeTicket,
  clearWebSocketUpgradeTicketsForTesting,
  getWebSocketUpgradeTicketCountForTesting,
} from "../services/websocket-upgrade-ticket.service.js";

describe("websocket-upgrade-ticket.service", () => {
  beforeEach(() => {
    clearWebSocketUpgradeTicketsForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearWebSocketUpgradeTicketsForTesting();
  });

  it("issues tokens that validate once", () => {
    const t = issueWebSocketUpgradeTicket();
    expect(t.length).toBeGreaterThan(20);
    expect(consumeWebSocketUpgradeTicket(t)).toBe(true);
    expect(consumeWebSocketUpgradeTicket(t)).toBe(false);
  });

  it("rejects unknown and empty tickets", () => {
    expect(consumeWebSocketUpgradeTicket("nope")).toBe(false);
    expect(consumeWebSocketUpgradeTicket("")).toBe(false);
    expect(consumeWebSocketUpgradeTicket(null)).toBe(false);
  });

  it("rejects expired tickets", () => {
    vi.useFakeTimers();
    const t = issueWebSocketUpgradeTicket();
    vi.advanceTimersByTime(121_000);
    expect(consumeWebSocketUpgradeTicket(t)).toBe(false);
  });

  it("prunes expired unused tickets when issuing a new one", () => {
    vi.useFakeTimers();
    issueWebSocketUpgradeTicket();
    expect(getWebSocketUpgradeTicketCountForTesting()).toBe(1);

    vi.advanceTimersByTime(121_000);
    const fresh = issueWebSocketUpgradeTicket();

    expect(getWebSocketUpgradeTicketCountForTesting()).toBe(1);
    expect(consumeWebSocketUpgradeTicket(fresh)).toBe(true);
    expect(getWebSocketUpgradeTicketCountForTesting()).toBe(0);
  });
});
