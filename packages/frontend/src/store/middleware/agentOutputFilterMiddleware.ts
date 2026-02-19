import type { Middleware } from "@reduxjs/toolkit";
import { appendAgentOutput, setSelectedTaskId } from "../slices/executeSlice";
import { createAgentOutputFilter } from "../../utils/agentOutputFilter";

/**
 * Middleware that holds an isolated agent output filter instance.
 * Intercepts appendAgentOutput to filter chunks before the reducer,
 * and setSelectedTaskId to reset the filter when switching tasks.
 */
export const agentOutputFilterMiddleware: Middleware = () => {
  const filter = createAgentOutputFilter();

  return (next) => (action) => {
    if (setSelectedTaskId.match(action)) {
      filter.reset();
    }
    if (appendAgentOutput.match(action)) {
      const filtered = filter.filter(action.payload.chunk);
      return next(appendAgentOutput({ taskId: action.payload.taskId, chunk: filtered }));
    }
    return next(action);
  };
};
