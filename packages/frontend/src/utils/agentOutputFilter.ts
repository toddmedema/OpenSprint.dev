/**
 * Filters live agent output to display only messages/content, hiding extra metadata.
 * Supports:
 * - Cursor agent stream-json (NDJSON): extracts text from message_delta, text, content_block_delta
 * - Plain text (Claude CLI, custom agents): passes through unchanged
 * Drops tool-call/code-context noise: type "tool_call", lineNumber/content/isContextLine,
 * and lines containing onOutput or ingestOutputChunk.
 */

const NOISE_SUBSTRINGS = ["onOutput", "ingestOutputChunk"];

function isNoiseLine(rawLine: string): boolean {
  return NOISE_SUBSTRINGS.some((s) => rawLine.includes(s));
}

function isCodeContextEntry(o: Record<string, unknown>): boolean {
  const hasLineNumber =
    typeof o.lineNumber === "number" ||
    (typeof o.lineNumber === "string" && (o.lineNumber as string).trim() !== "");
  if (!hasLineNumber) return false;
  return "content" in o || "isContextLine" in o;
}

/**
 * Extract text from a content array (message.content or similar).
 */
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
 * Returns the text to show, or null if the event should be hidden (metadata only).
 */
function extractContentFromEvent(obj: unknown, rawLine: string): string | null {
  if (obj === null || typeof obj !== "object") return null;
  if (isNoiseLine(rawLine)) return null;

  const o = obj as Record<string, unknown>;
  if (o.type === "tool_call") return null;
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

  // Cursor/Anthropic: {"type":"text","text":"..."}
  if (o.type === "text" && typeof o.text === "string") {
    return o.text;
  }

  // message_delta: {"type":"message_delta","delta":{"content":"..."}}
  if (
    o.type === "message_delta" &&
    o.delta &&
    typeof (o.delta as Record<string, unknown>).content === "string"
  ) {
    return (o.delta as Record<string, unknown>).content as string;
  }

  // content_block_delta: {"type":"content_block_delta","delta":{"text":"..."}} or delta.thinking
  if (o.type === "content_block_delta" && o.delta) {
    const delta = o.delta as Record<string, unknown>;
    if (delta.type === "thinking" && typeof delta.thinking === "string") {
      return delta.thinking;
    }
    if (typeof delta.text === "string") {
      return delta.text;
    }
  }

  // message: {"type":"message","content":[{"type":"text","text":"..."}]}
  if (o.type === "message" && Array.isArray(o.content)) {
    return extractTextFromContentArray(o.content);
  }

  // Cursor Composer: {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."}]}}
  if (o.type === "assistant" && o.message && typeof o.message === "object") {
    const msg = o.message as Record<string, unknown>;
    if (Array.isArray(msg.content)) {
      return extractTextFromContentArray(msg.content);
    }
  }

  // content_block_start with text: {"type":"content_block_start","content_block":{"type":"text","text":"..."}}
  if (o.type === "content_block_start" && o.content_block) {
    const block = o.content_block as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }

  // thinking: {"type":"thinking","content":"..."} or {"type":"thinking","thinking":"..."} or {"type":"thinking","subtype":"delta","text":"..."} (Cursor Composer)
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
    // Cursor emits many tiny thinking delta chunks; adding a newline per chunk causes hard wraps.
    return o.subtype === "delta" ? content : content + "\n";
  }

  // Generic: {"content":"..."} or {"text":"..."}
  if (typeof o.content === "string") return o.content;
  if (typeof o.text === "string") return o.text;

  // Metadata events (tool_use, tool_result, etc.) - hide
  return null;
}

function isThinkingDeltaEvent(obj: Record<string, unknown>): boolean {
  return obj.type === "thinking" && obj.subtype === "delta";
}

function isDiscreteAssistantMessageEvent(obj: Record<string, unknown>): boolean {
  return obj.type === "assistant" || obj.type === "message";
}

export interface AgentOutputFilter {
  filter(chunk: string): string;
  reset(): void;
}

/**
 * Creates an isolated agent output filter instance.
 * Each instance has its own line buffer - use one per stream to avoid state leaking.
 *
 * @returns Filter instance with filter() and reset() methods
 */
export function createAgentOutputFilter(): AgentOutputFilter {
  let lineBuffer = "";
  let previousLineWasThinkingDelta = false;
  let previousEmissionWasDiscreteAssistantMessage = false;
  let previousEmissionEndedWithNewline = true;

  const emitParsedEvent = (obj: unknown, rawLine: string, results: string[]): void => {
    const content = extractContentFromEvent(obj, rawLine);
    if (content) {
      const thinkingDelta =
        obj !== null &&
        typeof obj === "object" &&
        isThinkingDeltaEvent(obj as Record<string, unknown>);
      const discreteAssistantMessage =
        obj !== null &&
        typeof obj === "object" &&
        isDiscreteAssistantMessageEvent(obj as Record<string, unknown>);
      if (previousLineWasThinkingDelta && !thinkingDelta) {
        results.push("\n");
        previousEmissionEndedWithNewline = true;
      }
      if (
        !thinkingDelta &&
        discreteAssistantMessage &&
        previousEmissionWasDiscreteAssistantMessage &&
        !previousEmissionEndedWithNewline
      ) {
        results.push("\n");
        previousEmissionEndedWithNewline = true;
      }
      results.push(content);
      previousEmissionEndedWithNewline = /\n$/.test(content);
      previousEmissionWasDiscreteAssistantMessage = discreteAssistantMessage;
      previousLineWasThinkingDelta = thinkingDelta;
    } else {
      previousLineWasThinkingDelta = false;
      previousEmissionWasDiscreteAssistantMessage = false;
    }
  };

  const emitPlainText = (text: string, appendNewline: boolean, results: string[]): void => {
    if (!text) return;
    const trimmed = text.trim();
    if (trimmed && isNoiseLine(trimmed)) return;
    if (previousLineWasThinkingDelta) {
      results.push("\n");
    }
    previousLineWasThinkingDelta = false;
    previousEmissionWasDiscreteAssistantMessage = false;
    const value = appendNewline ? `${text}\n` : text;
    results.push(value);
    previousEmissionEndedWithNewline = /\n$/.test(value);
  };

  return {
    filter(chunk: string): string {
      if (!chunk) return "";

      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? ""; // Keep incomplete line in buffer

      const results: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (isNoiseLine(trimmed)) continue;

        try {
          const obj = JSON.parse(trimmed) as unknown;
          emitParsedEvent(obj, trimmed, results);
        } catch {
          // Not valid JSON - treat as plain text and pass through unless noise
          emitPlainText(line, true, results);
        }
      }

      // Streaming fallback: when trailing buffer does not look like NDJSON, emit it
      // immediately so plain text fragments are not held until a newline arrives.
      if (lineBuffer) {
        const trailingTrimmed = lineBuffer.trim();
        if (!trailingTrimmed) {
          emitPlainText(lineBuffer, false, results);
          lineBuffer = "";
        } else if (isNoiseLine(trailingTrimmed)) {
          lineBuffer = "";
        } else {
          try {
            const trailingObj = JSON.parse(trailingTrimmed) as unknown;
            emitParsedEvent(trailingObj, trailingTrimmed, results);
            lineBuffer = "";
          } catch {
            const looksLikeJsonPrefix =
              trailingTrimmed.startsWith("{") || trailingTrimmed.startsWith("[");
            if (!looksLikeJsonPrefix) {
              emitPlainText(lineBuffer, false, results);
              lineBuffer = "";
            }
          }
        }
      }

      return results.join("");
    },
    reset(): void {
      lineBuffer = "";
      previousLineWasThinkingDelta = false;
      previousEmissionWasDiscreteAssistantMessage = false;
      previousEmissionEndedWithNewline = true;
    },
  };
}

/**
 * Filters full NDJSON text (or plain text) in one pass.
 * Use for backfill and archived output; keep streaming filter for live chunks.
 *
 * @param raw - Full NDJSON text or plain text
 * @returns Filtered displayable text
 */
export function filterAgentOutput(raw: string): string {
  if (!raw) return "";
  const f = createAgentOutputFilter();
  let result = f.filter(raw);
  if (!raw.endsWith("\n")) {
    result += f.filter("\n"); // flush incomplete line
  }
  return result;
}
