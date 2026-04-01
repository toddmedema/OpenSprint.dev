/** Next midnight UTC (daily) or next Sunday 00:00 UTC (weekly). Used for nextRunAt in settings response. */
export function getNextScheduledSelfImprovementRunAt(
  frequency: "daily" | "weekly",
  now: Date = new Date()
): string {
  const n = now;
  const y = n.getUTCFullYear();
  const m = n.getUTCMonth();
  const d = n.getUTCDate();
  if (frequency === "daily") {
    return new Date(Date.UTC(y, m, d + 1)).toISOString();
  }
  const day = n.getUTCDay();
  const addDays = day === 0 ? 7 : 7 - day;
  return new Date(Date.UTC(y, m, d + addDays)).toISOString();
}
