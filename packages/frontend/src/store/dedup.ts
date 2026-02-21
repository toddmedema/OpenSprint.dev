/** Sentinel for skip-if-loading deduplication: thunk rejects with this instead of calling API. */
export const DEDUP_SKIP = "DEDUP_SKIP" as const;
