type FlushFn = () => void;

const flushCallbacks = new Set<FlushFn>();

/**
 * Register a PRD section flush callback. Returns an unregister function
 * suitable for use as a React useEffect cleanup.
 */
export function registerPrdFlush(fn: FlushFn): () => void {
  flushCallbacks.add(fn);
  return () => {
    flushCallbacks.delete(fn);
  };
}

/**
 * Flush all registered PRD section editors (e.g., before navigation or save).
 */
export function flushAllPrdEditors(): void {
  for (const fn of flushCallbacks) {
    fn();
  }
}
