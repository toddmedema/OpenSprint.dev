import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

describe("useMarkdownBlockDiffWorker", () => {
  describe("sync fallback (no Worker in jsdom)", () => {
    it("returns result synchronously with loading=false", async () => {
      const { useMarkdownBlockDiffWorker } = await import(
        "./useMarkdownBlockDiffWorker"
      );
      const { result } = renderHook(() =>
        useMarkdownBlockDiffWorker("# Old", "# New"),
      );
      expect(result.current.loading).toBe(false);
      expect(result.current.result).not.toBeNull();
      expect(result.current.result!.parseError).toBe(false);
      expect(result.current.result!.blocks.length).toBeGreaterThan(0);
    });

    it("detects added blocks", async () => {
      const { useMarkdownBlockDiffWorker } = await import(
        "./useMarkdownBlockDiffWorker"
      );
      const { result } = renderHook(() =>
        useMarkdownBlockDiffWorker("# Title", "# Title\n\nNew paragraph."),
      );
      const added = result.current.result!.blocks.filter(
        (b) => b.status === "added",
      );
      expect(added.length).toBeGreaterThan(0);
    });

    it("detects removed blocks", async () => {
      const { useMarkdownBlockDiffWorker } = await import(
        "./useMarkdownBlockDiffWorker"
      );
      const { result } = renderHook(() =>
        useMarkdownBlockDiffWorker(
          "# Title\n\nOld paragraph.",
          "# Title",
        ),
      );
      const removed = result.current.result!.blocks.filter(
        (b) => b.status === "removed",
      );
      expect(removed.length).toBeGreaterThan(0);
    });

    it("detects modified blocks with word diff", async () => {
      const { useMarkdownBlockDiffWorker } = await import(
        "./useMarkdownBlockDiffWorker"
      );
      const { result } = renderHook(() =>
        useMarkdownBlockDiffWorker("Hello world.", "Hello universe."),
      );
      const mod = result.current.result!.blocks.find(
        (b) => b.status === "modified",
      );
      expect(mod).toBeDefined();
      expect(mod!.wordDiff).toBeDefined();
    });

    it("returns all unchanged for identical content", async () => {
      const { useMarkdownBlockDiffWorker } = await import(
        "./useMarkdownBlockDiffWorker"
      );
      const content = "# Title\n\nParagraph.";
      const { result } = renderHook(() =>
        useMarkdownBlockDiffWorker(content, content),
      );
      expect(
        result.current.result!.blocks.every((b) => b.status === "unchanged"),
      ).toBe(true);
    });

    it("handles both empty strings", async () => {
      const { useMarkdownBlockDiffWorker } = await import(
        "./useMarkdownBlockDiffWorker"
      );
      const { result } = renderHook(() =>
        useMarkdownBlockDiffWorker("", ""),
      );
      expect(result.current.result!.blocks).toHaveLength(0);
      expect(result.current.result!.parseError).toBe(false);
    });

    it("recomputes when inputs change", async () => {
      const { useMarkdownBlockDiffWorker } = await import(
        "./useMarkdownBlockDiffWorker"
      );
      const { result, rerender } = renderHook(
        ({ from, to }: { from: string; to: string }) =>
          useMarkdownBlockDiffWorker(from, to),
        { initialProps: { from: "# A", to: "# B" } },
      );

      const firstBlocks = result.current.result!.blocks;
      expect(firstBlocks.length).toBeGreaterThan(0);

      rerender({ from: "# X", to: "# X\n\nNew." });
      const secondBlocks = result.current.result!.blocks;
      const added = secondBlocks.filter((b) => b.status === "added");
      expect(added.length).toBeGreaterThan(0);
    });
  });

  describe("async Worker path", () => {
    let originalWorker: typeof globalThis.Worker | undefined;
    let mockPostMessage: ReturnType<typeof vi.fn>;
    let workerHandlers: Map<string, Set<(e: MessageEvent) => void>>;

    beforeEach(() => {
      vi.resetModules();
      originalWorker = globalThis.Worker;
      workerHandlers = new Map();
      mockPostMessage = vi.fn();

      class MockWorker {
        private handlers = new Map<string, Set<(e: MessageEvent) => void>>();
        constructor() {
          workerHandlers = this.handlers;
        }
        postMessage(data: { id: number; fromContent: string; toContent: string }) {
          mockPostMessage(data);
        }
        addEventListener(type: string, handler: (e: MessageEvent) => void) {
          if (!this.handlers.has(type)) this.handlers.set(type, new Set());
          this.handlers.get(type)!.add(handler);
        }
        removeEventListener(type: string, handler: (e: MessageEvent) => void) {
          this.handlers.get(type)?.delete(handler);
        }
        terminate() {}
      }
      globalThis.Worker = MockWorker as unknown as typeof Worker;
    });

    afterEach(() => {
      if (originalWorker !== undefined) {
        globalThis.Worker = originalWorker;
      } else {
        // @ts-expect-error -- restoring undefined state
        delete globalThis.Worker;
      }
      vi.resetModules();
    });

    function simulateWorkerResponse(id: number) {
      const event = new MessageEvent("message", {
        data: {
          id,
          result: {
            blocks: [
              { status: "modified", markdown: "test", nodeType: "paragraph" },
            ],
            parseError: false,
          },
        },
      });
      workerHandlers.get("message")?.forEach((h) => h(event));
    }

    it("starts with loading=true", async () => {
      const { useMarkdownBlockDiffWorker } = await import(
        "./useMarkdownBlockDiffWorker"
      );
      const { result } = renderHook(() =>
        useMarkdownBlockDiffWorker("# Old", "# New"),
      );
      expect(result.current.loading).toBe(true);
      expect(result.current.result).toBeNull();
    });

    it("resolves to result after worker responds", async () => {
      const { useMarkdownBlockDiffWorker } = await import(
        "./useMarkdownBlockDiffWorker"
      );
      const { result } = renderHook(() =>
        useMarkdownBlockDiffWorker("# Old", "# New"),
      );
      expect(result.current.loading).toBe(true);

      act(() => {
        simulateWorkerResponse(1);
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.result).not.toBeNull();
      expect(result.current.result!.blocks).toHaveLength(1);
    });

    it("posts message to worker with correct payload", async () => {
      const { useMarkdownBlockDiffWorker } = await import(
        "./useMarkdownBlockDiffWorker"
      );
      renderHook(() =>
        useMarkdownBlockDiffWorker("from content", "to content"),
      );
      expect(mockPostMessage).toHaveBeenCalledWith({
        id: 1,
        fromContent: "from content",
        toContent: "to content",
      });
    });

    it("ignores stale worker responses", async () => {
      const { useMarkdownBlockDiffWorker } = await import(
        "./useMarkdownBlockDiffWorker"
      );
      const { result, rerender } = renderHook(
        ({ from, to }: { from: string; to: string }) =>
          useMarkdownBlockDiffWorker(from, to),
        { initialProps: { from: "# A", to: "# B" } },
      );

      rerender({ from: "# X", to: "# Y" });

      act(() => {
        simulateWorkerResponse(1);
      });
      expect(result.current.loading).toBe(true);

      act(() => {
        simulateWorkerResponse(2);
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.result).not.toBeNull();
    });
  });
});
