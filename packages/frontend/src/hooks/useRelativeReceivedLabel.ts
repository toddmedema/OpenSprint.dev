import { useEffect, useState } from "react";
import { formatRelativeReceived } from "../utils/formatRelativeReceived";

const TICK_MS = 10_000;

/** Re-computes a short relative label periodically while `iso` is set. */
export function useRelativeReceivedLabel(iso: string | undefined | null): string | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!iso) return;
    const id = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [iso]);

  if (!iso) return null;
  const label = formatRelativeReceived(iso, Date.now());
  return label || null;
}
