import { useMemo, useSyncExternalStore } from "react";
import { unstable_batchedUpdates } from "react-dom";

type Listener = () => void;

interface ClockStore {
  intervalId: number | null;
  listeners: Set<Listener>;
  snapshot: number;
}

const clockStores = new Map<number, ClockStore>();

function getClockStore(intervalMs: number): ClockStore {
  let store = clockStores.get(intervalMs);
  if (!store) {
    store = {
      intervalId: null,
      listeners: new Set<Listener>(),
      snapshot: Date.now(),
    };
    clockStores.set(intervalMs, store);
  }
  return store;
}

function getSnapshot(intervalMs: number): number {
  const store = getClockStore(intervalMs);
  return store.snapshot;
}

function subscribe(intervalMs: number, listener: Listener): () => void {
  const store = getClockStore(intervalMs);
  store.listeners.add(listener);

  if (store.intervalId == null) {
    store.snapshot = Date.now();
    store.intervalId = window.setInterval(() => {
      store!.snapshot = Date.now();
      // Many rows (TimelineList) each subscribe; notifying them in one tight loop can exceed
      // React's nested-update limit. Batch so useSyncExternalStore updates flush together.
      // Copy listeners so a notify callback cannot break iteration if it unsubscribes others.
      unstable_batchedUpdates(() => {
        for (const currentListener of [...store!.listeners]) {
          currentListener();
        }
      });
    }, intervalMs);
  }

  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0 && store.intervalId != null) {
      window.clearInterval(store.intervalId);
      store.intervalId = null;
    }
  };
}

export function useSharedNow(intervalMs: number, enabled = true): Date | null {
  const snapshot = useSyncExternalStore(
    enabled ? (listener) => subscribe(intervalMs, listener) : () => () => {},
    enabled ? () => getSnapshot(intervalMs) : () => 0,
    enabled ? () => getSnapshot(intervalMs) : () => 0
  );

  return useMemo(() => (enabled ? new Date(snapshot) : null), [enabled, snapshot]);
}
