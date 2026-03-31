import type { Middleware } from "@reduxjs/toolkit";
import {
  appendAgentOutput,
  setAgentOutputBackfill,
  setSelectedTaskId,
} from "../slices/executeSlice";
import { createAgentOutputFilter, filterAgentOutput } from "../../utils/agentOutputFilter";

/** Batch window in ms: collect chunks for this duration before dispatching. */
const BATCH_MS = 150;

/**
 * Middleware that holds an isolated agent output filter instance.
 * Intercepts appendAgentOutput to filter chunks, batches them for ~100-200ms,
 * then dispatches a single append with concatenated content to reduce Redux
 * dispatch frequency and React re-renders during heavy streaming.
 * Flushes pending content on setSelectedTaskId to ensure no loss.
 * Also filters setAgentOutputBackfill and resets filter on setSelectedTaskId.
 */
export const agentOutputFilterMiddleware: Middleware = () => {
  const filter = createAgentOutputFilter();
  const buffer = new Map<string, string[]>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = (
    next: (a: ReturnType<typeof appendAgentOutput>) => unknown,
    preserveCompletion?: boolean
  ) => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    for (const [taskId, chunks] of buffer) {
      const concatenated = chunks.join("");
      if (concatenated) {
        next(
          appendAgentOutput({
            taskId,
            chunk: concatenated,
            ...(preserveCompletion ? { preserveCompletion: true } : {}),
          })
        );
      }
    }
    buffer.clear();
  };

  return (next) => (action) => {
    if (setSelectedTaskId.match(action)) {
      // Flush runs before deselection is applied; without preserveCompletion, append would clear
      // per-task completion state that was set after the original chunks were buffered.
      flush(next, true);
      filter.reset();
      return next(action);
    }
    if (appendAgentOutput.match(action)) {
      const { taskId, chunk } = action.payload;
      const filtered = filter.filter(chunk);
      if (filtered) {
        const list = buffer.get(taskId) ?? [];
        list.push(filtered);
        buffer.set(taskId, list);
      }
      if (!flushTimer) {
        flushTimer = setTimeout(() => flush(next), BATCH_MS);
      }
      return next({ type: "@@agentOutputFilter/batched" });
    }
    if (setAgentOutputBackfill.match(action)) {
      const { taskId } = action.payload;
      // Discard buffered chunks for this task — the backfill supersedes them.
      // Without this, stale buffered chunks flush after the backfill replaces
      // state, causing duplicate trailing text.
      buffer.delete(taskId);
      if (buffer.size === 0 && flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      // Reset incremental filter so subsequent WS chunks are not processed
      // against stale partial-line state from before the backfill.
      filter.reset();
      const filtered = filterAgentOutput(action.payload.output);
      return next(setAgentOutputBackfill({ taskId, output: filtered }));
    }
    return next(action);
  };
};
