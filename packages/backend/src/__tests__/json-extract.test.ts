import { describe, it, expect } from "vitest";
import { extractJsonFromAgentResponse } from "../utils/json-extract.js";

describe("extractJsonFromAgentResponse", () => {
  describe("with requiredKey", () => {
    it("extracts and parses JSON containing the required key", () => {
      const content = `Here is my response:
\`\`\`json
{"status":"success","tasks":[{"title":"Fix bug"}]}
\`\`\``;
      const result = extractJsonFromAgentResponse<{ status: string; tasks: unknown[] }>(
        content,
        "tasks"
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe("success");
      expect(result!.tasks).toHaveLength(1);
      expect(result!.tasks[0]).toEqual({ title: "Fix bug" });
    });

    it("returns null when required key is not present", () => {
      const content = 'Some text {"foo":"bar","baz":1} more text';
      const result = extractJsonFromAgentResponse<{ foo: string }>(content, "status");
      expect(result).toBeNull();
    });

    it("returns null when no JSON object exists", () => {
      const content = "No JSON here, just plain text";
      const result = extractJsonFromAgentResponse<{ x: number }>(content, "x");
      expect(result).toBeNull();
    });

    it("returns null when JSON is malformed", () => {
      const content = 'Here is invalid JSON: {"status":"success" invalid}';
      const result = extractJsonFromAgentResponse<{ status: string }>(content, "status");
      expect(result).toBeNull();
    });

    it("extracts nested object containing the key", () => {
      const content = 'Prefix {"outer":{"status":"ok","nested":true}} suffix';
      const result = extractJsonFromAgentResponse<{ outer: { status: string } }>(
        content,
        "status"
      );
      expect(result).not.toBeNull();
      expect(result!.outer.status).toBe("ok");
    });
  });

  describe("without requiredKey", () => {
    it("extracts first JSON object in content", () => {
      const content = 'Before {"a":1,"b":2} after';
      const result = extractJsonFromAgentResponse<{ a: number; b: number }>(content);
      expect(result).not.toBeNull();
      expect(result!.a).toBe(1);
      expect(result!.b).toBe(2);
    });

    it("returns null when no JSON object exists", () => {
      const content = "No JSON here";
      const result = extractJsonFromAgentResponse<Record<string, unknown>>(content);
      expect(result).toBeNull();
    });

    it("returns null when JSON is malformed", () => {
      const content = 'Text {"broken": json} more';
      const result = extractJsonFromAgentResponse<{ broken: string }>(content);
      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(extractJsonFromAgentResponse<object>("")).toBeNull();
      expect(extractJsonFromAgentResponse<object>("", "key")).toBeNull();
    });

    it("handles JSON with escaped quotes in values", () => {
      const content = '{"status":"success","msg":"Say \\"hello\\""}';
      const result = extractJsonFromAgentResponse<{ status: string; msg: string }>(
        content,
        "status"
      );
      expect(result).not.toBeNull();
      expect(result!.msg).toBe('Say "hello"');
    });

    it("handles whitespace around JSON", () => {
      const content = "\n  \n  {\"x\": 42}  \n";
      const result = extractJsonFromAgentResponse<{ x: number }>(content, "x");
      expect(result).not.toBeNull();
      expect(result!.x).toBe(42);
    });
  });
});
