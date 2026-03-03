import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Query } from "@tanstack/react-query";
import { api } from "../client";
import type { DbStatusResponse } from "../client";

export const DB_STATUS_QUERY_KEY = ["db-status"] as const;
const CONNECTED_FALLBACK = {
  ok: true as const,
  state: "connected" as const,
  lastCheckedAt: null,
};

/** Backoff delays: 1s, 2s, 3s, then 5s cap for subsequent retries. */
const BACKOFF_MS = [1000, 2000, 3000] as const;
const BACKOFF_CAP_MS = 5000;
const CONNECTED_POLL_MS = 10_000;

/** Exported for tests. */
export function getBackoffDelayMs(attempt: number): number {
  if (attempt < BACKOFF_MS.length) return BACKOFF_MS[attempt];
  return BACKOFF_CAP_MS;
}

export function useDbStatus() {
  const reconnectAttemptRef = useRef(0);

  return useQuery({
    queryKey: DB_STATUS_QUERY_KEY,
    queryFn: () => (api.dbStatus?.get ? api.dbStatus.get() : Promise.resolve(CONNECTED_FALLBACK)),
    refetchInterval: (query: Query<DbStatusResponse>) => {
      const data = query.state.data;
      if (data?.ok) {
        reconnectAttemptRef.current = 0;
        return CONNECTED_POLL_MS;
      }
      const delay = getBackoffDelayMs(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      return delay;
    },
    refetchOnWindowFocus: true,
    retry: false,
  });
}
