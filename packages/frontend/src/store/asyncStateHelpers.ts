import type { ActionReducerMapBuilder, AsyncThunk } from "@reduxjs/toolkit";

/** Standard shape for a single async operation's loading/error state */
export type AsyncState = { loading: boolean; error: string | null };

/** Record of async states keyed by operation name */
export type AsyncStates<K extends string> = Record<K, AsyncState>;

/** Creates initial async states for the given keys */
export function createInitialAsyncStates<K extends string>(keys: readonly K[]): AsyncStates<K> {
  const initial: AsyncState = { loading: false, error: null };
  return Object.fromEntries(keys.map((k) => [k, { ...initial }])) as AsyncStates<K>;
}

type GetAsyncState<State> = (state: State) => AsyncState;

export interface AddAsyncHandlersOptions<State, Returned, ThunkArg = unknown> {
  defaultErrorMessage?: string;
  onPending?: (state: State, action: { meta: { arg: ThunkArg } }) => void;
  onFulfilled?: (state: State, action: { payload: Returned }) => void;
  onRejected?: (state: State, action: { meta: { arg: ThunkArg } }) => void;
}

/**
 * Adds standard pending/fulfilled/rejected handlers for loading and error state.
 * Optionally accepts onFulfilled for custom state updates when the thunk succeeds.
 */
export function addAsyncHandlers<State, Returned, ThunkArg, ThunkConfig>(
  builder: ActionReducerMapBuilder<State>,
  thunk: AsyncThunk<Returned, ThunkArg, ThunkConfig>,
  getAsyncState: GetAsyncState<State>,
  options: AddAsyncHandlersOptions<State, Returned, ThunkArg> | string = "Request failed"
): ActionReducerMapBuilder<State> {
  const opts = typeof options === "string" ? { defaultErrorMessage: options } : options;
  const defaultErrorMessage = opts.defaultErrorMessage ?? "Request failed";
  return builder
    .addCase(thunk.pending, (state, action) => {
      const s = getAsyncState(state);
      s.loading = true;
      s.error = null;
      opts.onPending?.(state, action as { meta: { arg: ThunkArg } });
    })
    .addCase(thunk.fulfilled, (state, action) => {
      const s = getAsyncState(state);
      s.loading = false;
      opts.onFulfilled?.(state, action);
    })
    .addCase(thunk.rejected, (state, action) => {
      const s = getAsyncState(state);
      s.loading = false;
      s.error = action.error.message || defaultErrorMessage;
      opts.onRejected?.(state, action as { meta: { arg: ThunkArg } });
    });
}
