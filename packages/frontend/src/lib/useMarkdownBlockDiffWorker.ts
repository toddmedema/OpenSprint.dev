import { useEffect, useMemo, useRef, useState } from "react";
import {
  computeMarkdownBlockDiff,
  type MarkdownDiffResult,
} from "./markdownBlockDiff";
import type { DiffWorkerResponse } from "./markdownBlockDiff.worker";

const CAN_USE_WORKER = typeof Worker !== "undefined";

export interface MarkdownDiffWorkerState {
  result: MarkdownDiffResult | null;
  loading: boolean;
}

/**
 * Runs computeMarkdownBlockDiff in a Web Worker when available,
 * falling back to synchronous useMemo in environments without Worker
 * support (e.g. jsdom/SSR).
 */
export function useMarkdownBlockDiffWorker(
  fromContent: string,
  toContent: string,
): MarkdownDiffWorkerState {
  const syncResult = useMemo(() => {
    if (CAN_USE_WORKER) return null;
    return computeMarkdownBlockDiff(fromContent, toContent);
  }, [fromContent, toContent]);

  const [asyncState, setAsyncState] = useState<MarkdownDiffWorkerState>({
    result: null,
    loading: CAN_USE_WORKER,
  });

  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!CAN_USE_WORKER) return;

    const id = ++reqIdRef.current;
    setAsyncState({ result: null, loading: true });

    if (!workerRef.current) {
      try {
        workerRef.current = new Worker(
          new URL("./markdownBlockDiff.worker.ts", import.meta.url),
          { type: "module" },
        );
      } catch {
        const result = computeMarkdownBlockDiff(fromContent, toContent);
        setAsyncState({ result, loading: false });
        return;
      }
    }

    const worker = workerRef.current;
    const handler = (e: MessageEvent<DiffWorkerResponse>) => {
      if (e.data.id === id) {
        setAsyncState({ result: e.data.result, loading: false });
      }
    };
    worker.addEventListener("message", handler);
    worker.postMessage({ id, fromContent, toContent });

    return () => {
      worker.removeEventListener("message", handler);
    };
  }, [fromContent, toContent]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  if (!CAN_USE_WORKER) {
    return { result: syncResult, loading: false };
  }

  return asyncState;
}
