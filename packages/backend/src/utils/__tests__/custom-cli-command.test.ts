import { describe, it, expect } from "vitest";
import {
  CustomCliCommandParseError,
  parseCustomCliCommandLine,
} from "../custom-cli-command.js";

describe("parseCustomCliCommandLine", () => {
  it("parses a single executable", () => {
    expect(parseCustomCliCommandLine("my-agent")).toEqual(["my-agent"]);
  });

  it("parses executable with flags", () => {
    expect(parseCustomCliCommandLine("my-cli --verbose")).toEqual(["my-cli", "--verbose"]);
  });

  it("respects double quotes for paths with spaces", () => {
    expect(parseCustomCliCommandLine('"/path/with spaces/cli" --verbose')).toEqual([
      "/path/with spaces/cli",
      "--verbose",
    ]);
  });

  it("respects single quotes", () => {
    expect(parseCustomCliCommandLine("'my tool' run")).toEqual(["my tool", "run"]);
  });

  it("supports escapes inside double quotes", () => {
    expect(parseCustomCliCommandLine('"say \\"hi\\""')).toEqual(['say "hi"']);
  });

  it("treats shell metacharacters in unquoted tokens literally (no shell)", () => {
    expect(parseCustomCliCommandLine("my-agent;rm")).toEqual(["my-agent;rm"]);
  });

  it("throws on empty or whitespace-only input", () => {
    expect(() => parseCustomCliCommandLine("")).toThrow(CustomCliCommandParseError);
    expect(() => parseCustomCliCommandLine("   ")).toThrow(CustomCliCommandParseError);
  });

  it("throws on null bytes and newlines", () => {
    expect(() => parseCustomCliCommandLine("foo\0bar")).toThrow(CustomCliCommandParseError);
    expect(() => parseCustomCliCommandLine("foo\nbar")).toThrow(CustomCliCommandParseError);
    expect(() => parseCustomCliCommandLine("foo\rbar")).toThrow(CustomCliCommandParseError);
  });

  it("throws on unclosed quotes", () => {
    expect(() => parseCustomCliCommandLine('foo "bar')).toThrow(CustomCliCommandParseError);
    expect(() => parseCustomCliCommandLine("foo 'bar")).toThrow(CustomCliCommandParseError);
  });

  it("throws when executable token is empty", () => {
    expect(() => parseCustomCliCommandLine('"" --flag')).toThrow(CustomCliCommandParseError);
  });
});
