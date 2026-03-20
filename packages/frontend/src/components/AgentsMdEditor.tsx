import { useRef } from "react";

interface AgentsMdEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onSave?: () => void;
  placeholder?: string;
}

interface EditResult {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
}

function wrapSelection(
  value: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
  placeholder: string
): EditResult {
  const selectedText = value.slice(start, end);
  const insertedText = selectedText || placeholder;
  const nextValue = value.slice(0, start) + prefix + insertedText + suffix + value.slice(end);
  const nextSelectionStart = start + prefix.length;
  const nextSelectionEnd = nextSelectionStart + insertedText.length;

  return {
    nextValue,
    selectionStart: nextSelectionStart,
    selectionEnd: nextSelectionEnd,
  };
}

function toggleLinePrefix(value: string, start: number, end: number, prefix: string): EditResult {
  const blockStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextLineBreak = value.indexOf("\n", end);
  const blockEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
  const block = value.slice(blockStart, blockEnd);
  const lines = block.split("\n");
  const everyLinePrefixed = lines.every((line) => line.startsWith(prefix));
  const updatedLines = lines.map((line) => {
    if (!line.length) {
      return everyLinePrefixed ? "" : prefix;
    }

    return everyLinePrefixed ? line.slice(prefix.length) : `${prefix}${line}`;
  });
  const nextBlock = updatedLines.join("\n");
  const nextValue = value.slice(0, blockStart) + nextBlock + value.slice(blockEnd);
  const selectionDelta = nextBlock.length - block.length;

  return {
    nextValue,
    selectionStart: blockStart,
    selectionEnd: end + selectionDelta,
  };
}

const TOOLBAR_ACTIONS = [
  {
    label: "H2",
    ariaLabel: "Heading",
    apply: (value: string, start: number, end: number) =>
      toggleLinePrefix(value, start, end, "## "),
  },
  {
    label: "B",
    ariaLabel: "Bold",
    apply: (value: string, start: number, end: number) =>
      wrapSelection(value, start, end, "**", "**", "bold text"),
  },
  {
    label: "I",
    ariaLabel: "Italic",
    apply: (value: string, start: number, end: number) =>
      wrapSelection(value, start, end, "_", "_", "italic text"),
  },
  {
    label: "</>",
    ariaLabel: "Code",
    apply: (value: string, start: number, end: number) =>
      wrapSelection(value, start, end, "`", "`", "code"),
  },
  {
    label: "Link",
    ariaLabel: "Link",
    apply: (value: string, start: number, end: number) =>
      wrapSelection(value, start, end, "[", "](https://example.com)", "link text"),
  },
  {
    label: "List",
    ariaLabel: "Bullet list",
    apply: (value: string, start: number, end: number) => toggleLinePrefix(value, start, end, "- "),
  },
];

export function AgentsMdEditor({
  value,
  onChange,
  onBlur,
  onSave,
  placeholder,
}: AgentsMdEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const applyEdit = (edit: EditResult) => {
    onChange(edit.nextValue);

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  };

  const handleToolbarAction = (
    action: (value: string, start: number, end: number) => EditResult
  ) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    applyEdit(action(value, start, end));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave?.();
    }
  };

  return (
    <div className="rounded-lg border border-theme-border bg-theme-bg-elevated">
      <div className="flex flex-wrap items-center gap-2 border-b border-theme-border px-3 py-2">
        {TOOLBAR_ACTIONS.map((action) => (
          <button
            key={action.ariaLabel}
            type="button"
            aria-label={action.ariaLabel}
            onClick={() => handleToolbarAction(action.apply)}
            className="rounded border border-theme-border bg-theme-surface px-2 py-1 text-xs font-semibold text-theme-text transition-colors hover:bg-theme-bg"
          >
            {action.label}
          </button>
        ))}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="min-h-[280px] w-full resize-y border-0 bg-transparent px-4 py-3 font-mono text-sm leading-6 text-theme-text outline-none"
        data-testid="agents-md-editor-textarea"
      />

      <div className="border-t border-theme-border px-3 py-2 text-xs text-theme-muted">
        Markdown supported. Use Cmd/Ctrl+S to save.
      </div>
    </div>
  );
}
