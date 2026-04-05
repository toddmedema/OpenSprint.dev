import { createLogger } from "./logger.js";

const log = createLogger("fire-and-forget");

/**
 * Attach a `.catch()` to a fire-and-forget promise that logs failures at warn
 * level with structured context instead of silently swallowing them.
 *
 * Use this wherever the caller intentionally does not `await` a side-effect
 * promise (event-log writes, lease releases, heartbeat deletes, etc.) but
 * still wants failures to be observable in logs.
 */
export function fireAndForget(promise: Promise<unknown>, context: string): void {
  promise.catch((err: unknown) => {
    log.warn("fire-and-forget failed", {
      context,
      err: err instanceof Error ? err.message : String(err),
    });
  });
}
