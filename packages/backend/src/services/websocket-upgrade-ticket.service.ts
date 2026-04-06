import { randomBytes } from "node:crypto";

const TTL_MS = 120_000;

const tickets = new Map<string, number>();

function pruneExpiredWebSocketUpgradeTickets(now: number): void {
  for (const [ticket, expiresAt] of tickets) {
    if (expiresAt <= now) {
      tickets.delete(ticket);
    }
  }
}

/** Issue a one-time WebSocket upgrade ticket (valid ~2 minutes until consumed). */
export function issueWebSocketUpgradeTicket(): string {
  const now = Date.now();
  pruneExpiredWebSocketUpgradeTickets(now);
  const id = randomBytes(32).toString("base64url");
  tickets.set(id, now + TTL_MS);
  return id;
}

/**
 * Validates and consumes a ticket. Returns false for unknown, expired, empty, or reused tickets.
 */
export function consumeWebSocketUpgradeTicket(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  pruneExpiredWebSocketUpgradeTickets(Date.now());
  const expiresAt = tickets.get(trimmed);
  if (expiresAt == null) return false;
  tickets.delete(trimmed);
  if (Date.now() > expiresAt) return false;
  return true;
}

/** Test helper: clear in-memory tickets between tests. */
export function clearWebSocketUpgradeTicketsForTesting(): void {
  tickets.clear();
}

/** Test helper: current number of tracked in-memory tickets. */
export function getWebSocketUpgradeTicketCountForTesting(): number {
  return tickets.size;
}
