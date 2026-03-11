import { useEffect, useRef, useState, useCallback } from "react";

/**
 * In-page find bar for the Electron app. Shown when user presses Ctrl+F / Cmd+F.
 * Uses webContents.findInPage() via preload IPC.
 */
export function FindBar() {
  const [visible, setVisible] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const electron = typeof window !== "undefined" ? window.electron : undefined;

  const openBar = useCallback(() => {
    setVisible(true);
    setSearchText("");
    setActiveMatch(0);
    setMatchCount(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!electron) return;
    const cleanup = electron.onOpenFindBar(openBar);
    return cleanup;
  }, [electron, openBar]);

  useEffect(() => {
    if (!electron?.onFindResult) return;
    const cleanup = electron.onFindResult((result) => {
      setActiveMatch(result.activeMatchOrdinal);
      setMatchCount(result.matches);
    });
    return cleanup;
  }, [electron]);

  const closeBar = useCallback(() => {
    if (!electron) return;
    electron.stopFindInPage("clearSelection").then(() => {
      setVisible(false);
      setSearchText("");
      setActiveMatch(0);
      setMatchCount(0);
    });
  }, [electron]);

  const runFind = useCallback(
    (text: string, forward: boolean, findNext = false) => {
      if (!electron || !text.trim()) return;
      electron.findInPage(text, { forward, findNext, caseSensitive: false });
    },
    [electron]
  );

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeBar();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        runFind(searchText, !e.shiftKey, true);
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [visible, searchText, closeBar, runFind]);

  useEffect(() => {
    if (!searchText.trim()) {
      if (electron) electron.stopFindInPage("clearSelection");
      setActiveMatch(0);
      setMatchCount(0);
      return;
    }
    runFind(searchText, true, false);
  }, [searchText, electron, runFind]);

  if (!electron || !visible) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center gap-2 border-b border-theme-border bg-theme-surface px-3 py-2 shadow-sm"
      role="search"
    >
      <input
        ref={inputRef}
        type="text"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        placeholder="Find in page..."
        className="h-8 flex-1 min-w-0 rounded border border-theme-border bg-theme-input-bg px-2 py-1 text-sm text-theme-input-text placeholder:text-theme-input-placeholder focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-label="Find in page"
      />
      <span className="shrink-0 text-sm text-theme-muted" aria-live="polite">
        {searchText.trim()
          ? matchCount === 0
            ? "No matches"
            : `${activeMatch} of ${matchCount}`
          : ""}
      </span>
      <button
        type="button"
        onClick={() => runFind(searchText, false, true)}
        className="rounded px-2 py-1 text-sm text-theme-text hover:bg-theme-surface-muted disabled:opacity-50"
        title="Previous (Shift+Enter)"
        disabled={!searchText.trim()}
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => runFind(searchText, true, true)}
        className="rounded px-2 py-1 text-sm text-theme-text hover:bg-theme-surface-muted disabled:opacity-50"
        title="Next (Enter)"
        disabled={!searchText.trim()}
      >
        ↓
      </button>
      <button
        type="button"
        onClick={closeBar}
        className="rounded px-2 py-1 text-sm text-theme-muted hover:bg-theme-surface-muted hover:text-theme-text"
        title="Close (Esc)"
        aria-label="Close find bar"
      >
        ✕
      </button>
    </div>
  );
}
