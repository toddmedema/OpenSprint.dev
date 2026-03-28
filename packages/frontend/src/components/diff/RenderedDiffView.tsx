import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  computeMarkdownBlockDiff,
  type DiffBlock,
  type WordDiffPart,
} from "../../lib/markdownBlockDiff";

export interface RenderedDiffViewProps {
  fromContent: string;
  toContent: string;
  onParseError?: () => void;
}

export const INITIAL_BLOCK_CAP = 80;

const STATUS_BADGE: Record<string, { label: string; className: string } | null> = {
  added: { label: "+ Added", className: "bg-theme-success-bg text-theme-success-text border border-theme-success-border" },
  removed: { label: "− Removed", className: "bg-theme-error-bg text-theme-error-text border border-theme-error-border" },
  modified: { label: "~ Modified", className: "bg-theme-warning-bg text-theme-warning-text border border-theme-warning-border" },
  unchanged: null,
};

function WordDiffSpans({ parts }: { parts: WordDiffPart[] }) {
  return (
    <div className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <ins
              key={i}
              className="bg-theme-success-bg text-theme-success-text underline decoration-theme-success-border rounded-sm px-0.5"
              aria-label="Added text"
              data-diff-word="added"
            >
              {part.value}
            </ins>
          );
        }
        if (part.removed) {
          return (
            <del
              key={i}
              className="bg-theme-error-bg text-theme-error-text line-through rounded-sm px-0.5"
              aria-label="Removed text"
              data-diff-word="removed"
            >
              {part.value}
            </del>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </div>
  );
}

function BlockWrapper({
  block,
  children,
  descriptionId,
}: {
  block: DiffBlock;
  children: React.ReactNode;
  descriptionId: string;
}) {
  const badge = STATUS_BADGE[block.status];
  switch (block.status) {
    case "added":
      return (
        <div
          className="bg-theme-success-bg border-l-4 border-theme-success-border pl-3 rounded-r relative"
          data-diff-status="added"
          role="group"
          aria-label="Added block"
          aria-describedby={descriptionId}
        >
          {badge && (
            <span className={`inline-block text-[10px] font-medium rounded px-1.5 py-0.5 mb-1 ${badge.className}`} id={descriptionId}>
              {badge.label}
            </span>
          )}
          {children}
        </div>
      );
    case "removed":
      return (
        <div
          className="bg-theme-error-bg border-l-4 border-theme-error-border pl-3 rounded-r line-through opacity-75 relative"
          data-diff-status="removed"
          role="group"
          aria-label="Removed block"
          aria-describedby={descriptionId}
        >
          {badge && (
            <span className={`inline-block text-[10px] font-medium rounded px-1.5 py-0.5 mb-1 no-underline ${badge.className}`} id={descriptionId}>
              {badge.label}
            </span>
          )}
          {children}
        </div>
      );
    case "modified":
      return (
        <div
          className="border-l-4 border-theme-warning-border pl-3 rounded-r relative"
          data-diff-status="modified"
          role="group"
          aria-label="Modified block"
          aria-describedby={descriptionId}
        >
          {badge && (
            <span className={`inline-block text-[10px] font-medium rounded px-1.5 py-0.5 mb-1 ${badge.className}`} id={descriptionId}>
              {badge.label}
            </span>
          )}
          {children}
        </div>
      );
    default:
      return (
        <div data-diff-status="unchanged" role="group" aria-label="Unchanged block">
          {children}
        </div>
      );
  }
}

function RenderBlock({ block, index }: { block: DiffBlock; index: number }) {
  const descriptionId = `diff-block-desc-${index}`;
  return (
    <BlockWrapper block={block} descriptionId={descriptionId}>
      {block.status === "modified" && block.wordDiff ? (
        <WordDiffSpans parts={block.wordDiff} />
      ) : (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.markdown}</ReactMarkdown>
      )}
    </BlockWrapper>
  );
}

export function RenderedDiffView({
  fromContent,
  toContent,
  onParseError,
}: RenderedDiffViewProps) {
  const [expanded, setExpanded] = useState(false);

  const result = useMemo(() => {
    const r = computeMarkdownBlockDiff(fromContent, toContent);
    if (r.parseError) onParseError?.();
    return r;
  }, [fromContent, toContent, onParseError]);

  if (result.parseError) {
    return (
      <div
        className="p-4 text-sm text-theme-muted"
        data-testid="diff-view-parse-error"
      >
        <span className="inline-block px-2 py-0.5 mb-2 rounded text-xs bg-theme-warning-bg text-theme-warning-text">
          Markdown parsing failed
        </span>
        <p>Unable to render markdown diff. Please use raw mode.</p>
      </div>
    );
  }

  const hasChanges = result.blocks.some((b) => b.status !== "unchanged");

  if (result.blocks.length === 0 || !hasChanges) {
    return (
      <div
        className="p-4 text-sm text-theme-muted"
        data-testid="diff-view-no-changes"
      >
        No changes
      </div>
    );
  }

  const isCapped = result.blocks.length > INITIAL_BLOCK_CAP && !expanded;
  const visibleBlocks = isCapped
    ? result.blocks.slice(0, INITIAL_BLOCK_CAP)
    : result.blocks;
  const hiddenCount = result.blocks.length - visibleBlocks.length;

  return (
    <div
      className="prose prose-sm dark:prose-invert prose-execute-task max-w-none p-4 overflow-y-auto max-h-[24rem]"
      data-testid="diff-view-rendered"
    >
      {visibleBlocks.map((block, i) => (
        <RenderBlock key={i} block={block} index={i} />
      ))}
      {isCapped && (
        <div className="not-prose pt-2 border-t border-theme-border">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-sm text-accent-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-ring rounded"
            data-testid="diff-view-rendered-show-more"
          >
            Show more ({hiddenCount} more block{hiddenCount !== 1 ? "s" : ""})
          </button>
        </div>
      )}
    </div>
  );
}
