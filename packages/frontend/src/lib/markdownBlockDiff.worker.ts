import { computeMarkdownBlockDiff } from "./markdownBlockDiff";

export interface DiffWorkerRequest {
  id: number;
  fromContent: string;
  toContent: string;
}

export interface DiffWorkerResponse {
  id: number;
  result: ReturnType<typeof computeMarkdownBlockDiff>;
}

self.onmessage = (e: MessageEvent<DiffWorkerRequest>) => {
  const { id, fromContent, toContent } = e.data;
  const result = computeMarkdownBlockDiff(fromContent, toContent);
  self.postMessage({ id, result } satisfies DiffWorkerResponse);
};
