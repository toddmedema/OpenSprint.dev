import { useMemo, useSyncExternalStore } from "react";

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
      for (const currentListener of store!.listeners) {
        currentListener();
      }
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
