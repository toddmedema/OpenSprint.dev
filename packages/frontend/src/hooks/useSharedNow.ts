import { useMemo, useSyncExternalStore } from "react";
import { unstable_batchedUpdates } from "react-dom";

type Listener = () => void;

interface ClockStore {
  intervalId: number | null;
  listeners: Set<Listener>;
  snapshot: number;
  getSnapshot: () => number;
  subscribe: (listener: Listener) => () => void;
}

const clockStores = new Map<number, ClockStore>();
const NOOP_UNSUBSCRIBE = () => {};
const EMPTY_SUBSCRIBE = () => NOOP_UNSUBSCRIBE;
const ZERO_SNAPSHOT = () => 0;

function getClockStore(intervalMs: number): ClockStore {
  let store = clockStores.get(intervalMs);
  if (!store) {
    const listeners = new Set<Listener>();
    store = {
      intervalId: null,
      listeners,
      snapshot: Date.now(),
      getSnapshot: () => store!.snapshot,
      subscribe: (listener) => {
        store!.listeners.add(listener);

        if (store!.intervalId == null) {
          store!.snapshot = Date.now();
          store!.intervalId = window.setInterval(() => {
            const nextSnapshot = Date.now();
            if (nextSnapshot === store!.snapshot) return;
            store!.snapshot = nextSnapshot;
            // Many rows (TimelineList) each subscribe; notifying them in one tight loop can exceed
            // React's nested-update limit. Batch so useSyncExternalStore updates flush together.
            // Copy listeners so a notify callback cannot break iteration if it unsubscribes others.
            unstable_batchedUpdates(() => {
              for (const currentListener of [...listeners]) {
                currentListener();
              }
            });
          }, intervalMs);
        }

        return () => {
          store!.listeners.delete(listener);
          if (store!.listeners.size === 0 && store!.intervalId != null) {
            window.clearInterval(store!.intervalId);
            store!.intervalId = null;
          }
        };
      },
    };
    clockStores.set(intervalMs, store);
  }
  return store;
}

export function useSharedNow(intervalMs: number, enabled = true): Date | null {
  const store = useMemo(
    () => (enabled ? getClockStore(intervalMs) : null),
    [enabled, intervalMs]
  );
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? EMPTY_SUBSCRIBE,
    store?.getSnapshot ?? ZERO_SNAPSHOT,
    store?.getSnapshot ?? ZERO_SNAPSHOT
  );

  return useMemo(() => (enabled ? new Date(snapshot) : null), [enabled, snapshot]);
}
