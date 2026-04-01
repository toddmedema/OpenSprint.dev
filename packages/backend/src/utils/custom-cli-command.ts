/**
 * Parse a custom agent CLI command line into argv tokens without invoking a shell.
 * Supports double-quoted segments (with \\ and \") and single-quoted segments.
 */
export class CustomCliCommandParseError extends Error {
  override readonly name = "CustomCliCommandParseError";
  constructor(message: string) {
    super(message);
  }
}

export function parseCustomCliCommandLine(commandLine: string): string[] {
  const s = commandLine.trim();
  if (!s) {
    throw new CustomCliCommandParseError("Custom CLI command is empty or whitespace only");
  }
  if (/[\0\r\n]/.test(s)) {
    throw new CustomCliCommandParseError(
      "Custom CLI command must not contain null bytes or newlines"
    );
  }

  const tokens: string[] = [];
  let i = 0;

  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i >= s.length) break;

    let token = "";
    const c = s[i]!;

    if (c === '"') {
      i++;
      let closed = false;
      while (i < s.length) {
        const ch = s[i]!;
        if (ch === "\\") {
          i++;
          if (i >= s.length) {
            throw new CustomCliCommandParseError("Unterminated escape in custom CLI command");
          }
          token += s[i]!;
          i++;
          continue;
        }
        if (ch === '"') {
          i++;
          closed = true;
          break;
        }
        token += ch;
        i++;
      }
      if (!closed) {
        throw new CustomCliCommandParseError("Unclosed double quote in custom CLI command");
      }
    } else if (c === "'") {
      i++;
      while (i < s.length && s[i] !== "'") {
        token += s[i]!;
        i++;
      }
      if (i >= s.length) {
        throw new CustomCliCommandParseError("Unclosed single quote in custom CLI command");
      }
      i++;
    } else {
      while (i < s.length && !/\s/.test(s[i]!)) {
        token += s[i]!;
        i++;
      }
    }

    tokens.push(token);
  }

  if (tokens.length === 0 || !tokens[0]) {
    throw new CustomCliCommandParseError("Custom CLI command must include a non-empty executable");
  }

  return tokens;
}
