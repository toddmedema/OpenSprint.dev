/**
 * Filters agent output for live stream and persisted log: show only user-facing
 * messages; drop tool-call, code-context, and internal callback noise.
 *
 * Noise filtered out:
 * - NDJSON type "tool_call" (tool lifecycle events)
 * - Code-context entries (lineNumber/content/isContextLine)
 * - Lines containing internal names: onOutput, ingestOutputChunk
 */

/** Substrings that indicate internal/code noise; lines containing these are dropped */
const NOISE_SUBSTRINGS = ["onOutput", "ingestOutputChunk"];

function isNoiseLine(rawLine: string): boolean {
  return NOISE_SUBSTRINGS.some((s) => rawLine.includes(s));
}

/** Code-context shape: lineNumber + (content or isContextLine) */
function isCodeContextEntry(o: Record<string, unknown>): boolean {
  const hasLineNumber =
    typeof o.lineNumber === "number" ||
    (typeof o.lineNumber === "string" && o.lineNumber.trim() !== "");
  if (!hasLineNumber) return false;
  return "content" in o || "isContextLine" in o;
}

function extractTextFromContentArray(content: unknown[]): string | null {
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
      const t = (block as Record<string, unknown>).text;
      if (typeof t === "string") parts.push(t);
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

/**
 * Extract displayable content from a single JSON event.
 * Returns the text to show, or null if the event should be hidden (noise).
 */
function extractContentFromEvent(obj: unknown, rawLine: string): string | null {
  if (obj === null || typeof obj !== "object") return null;
  if (isNoiseLine(rawLine)) return null;

  const o = obj as Record<string, unknown>;

  // Explicitly drop tool-call lifecycle (noise)
  if (o.type === "tool_call") return null;

  // Drop code-context entries (lineNumber/content/isContextLine)
  if (isCodeContextEntry(o)) return null;

  const nestedError =
    o.error && typeof o.error === "object" ? (o.error as Record<string, unknown>) : null;
  const explicitErrorMessage =
    typeof o.message === "string"
      ? o.message
      : typeof o.error === "string"
        ? o.error
        : nestedError && typeof nestedError.message === "string"
          ? nestedError.message
          : typeof o.detail === "string"
            ? o.detail
            : null;

  if (
    ((o.type === "error" || o.subtype === "error") && explicitErrorMessage) ||
    (o.status === "error" && explicitErrorMessage)
  ) {
    return `[Agent error: ${explicitErrorMessage}]\n`;
  }

  if (o.type === "text" && typeof o.text === "string") return o.text;

  if (
    o.type === "message_delta" &&
    o.delta &&
    typeof (o.delta as Record<string, unknown>).content === "string"
  ) {
    return (o.delta as Record<string, unknown>).content as string;
  }

  if (o.type === "content_block_delta" && o.delta) {
    const delta = o.delta as Record<string, unknown>;
    if (delta.type === "thinking" && typeof delta.thinking === "string") {
      return delta.thinking;
    }
    if (typeof delta.text === "string") return delta.text;
  }

  if (o.type === "message" && Array.isArray(o.content)) {
    return extractTextFromContentArray(o.content);
  }

  if (o.type === "assistant" && o.message && typeof o.message === "object") {
    const msg = o.message as Record<string, unknown>;
    if (Array.isArray(msg.content)) return extractTextFromContentArray(msg.content);
  }

  if (o.type === "content_block_start" && o.content_block) {
    const block = o.content_block as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") return block.text;
  }

  if (o.type === "thinking") {
    const content =
      typeof o.content === "string"
        ? o.content
        : typeof o.thinking === "string"
          ? o.thinking
          : typeof o.text === "string"
            ? o.text
            : null;
    if (!content) return null;
    return o.subtype === "delta" ? content : content + "\n";
  }

  if (typeof o.content === "string") return o.content;
  if (typeof o.text === "string") return o.text;

  return null;
}

function isThinkingDeltaEvent(obj: Record<string, unknown>): boolean {
  return obj.type === "thinking" && obj.subtype === "delta";
}

export interface AgentOutputFilter {
  filter(chunk: string): string;
  reset(): void;
}

/**
 * Stateful filter for streaming chunks. Use one instance per agent run.
 */
export function createAgentOutputFilter(): AgentOutputFilter {
  let lineBuffer = "";
  let previousLineWasThinkingDelta = false;

  return {
    filter(chunk: string): string {
      if (!chunk) return "";

      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      const results: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (isNoiseLine(trimmed)) continue;

        try {
          const obj = JSON.parse(trimmed) as unknown;
          const content = extractContentFromEvent(obj, trimmed);
          if (content) {
            const thinkingDelta =
              obj !== null &&
              typeof obj === "object" &&
              isThinkingDeltaEvent(obj as Record<string, unknown>);
            if (previousLineWasThinkingDelta && !thinkingDelta) {
              results.push("\n");
            }
            results.push(content);
            previousLineWasThinkingDelta = thinkingDelta;
          } else {
            previousLineWasThinkingDelta = false;
          }
        } catch {
          if (previousLineWasThinkingDelta) results.push("\n");
          previousLineWasThinkingDelta = false;
          results.push(line + "\n");
        }
      }

      return results.join("");
    },
    reset(): void {
      lineBuffer = "";
      previousLineWasThinkingDelta = false;
    },
  };
}

/**
 * One-pass filter for full text (e.g. backfill from file, archived log).
 */
export function filterAgentOutput(raw: string): string {
  if (!raw) return "";
  const f = createAgentOutputFilter();
  let result = f.filter(raw);
  if (!raw.endsWith("\n")) {
    result += f.filter("\n");
  }
  return result;
}
