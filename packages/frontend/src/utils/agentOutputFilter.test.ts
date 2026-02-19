import { describe, it, expect } from "vitest";
import { createAgentOutputFilter } from "./agentOutputFilter";

describe("agentOutputFilter", () => {
  describe("createAgentOutputFilter", () => {
    it("returns an instance with filter and reset methods", () => {
      const f = createAgentOutputFilter();
      expect(typeof f.filter).toBe("function");
      expect(typeof f.reset).toBe("function");
    });

    it("passes through plain text unchanged", () => {
      const f = createAgentOutputFilter();
      expect(f.filter("Hello world\n")).toBe("Hello world\n");
      expect(f.filter("Some agent output\n")).toBe("Some agent output\n");
    });

    it("extracts text from Cursor stream-json type:text", () => {
      const f = createAgentOutputFilter();
      const chunk = '{"type":"text","text":"Hello from agent"}\n';
      expect(f.filter(chunk)).toBe("Hello from agent");
    });

    it("extracts content from message_delta", () => {
      const f = createAgentOutputFilter();
      const chunk = '{"type":"message_delta","delta":{"content":"Thinking..."}}\n';
      expect(f.filter(chunk)).toBe("Thinking...");
    });

    it("extracts text from content_block_delta", () => {
      const f = createAgentOutputFilter();
      const chunk = '{"type":"content_block_delta","delta":{"text":"Code here"}}\n';
      expect(f.filter(chunk)).toBe("Code here");
    });

    it("extracts text from message content array", () => {
      const f = createAgentOutputFilter();
      const chunk =
        '{"type":"message","content":[{"type":"text","text":"Full response"}]}\n';
      expect(f.filter(chunk)).toBe("Full response");
    });

    it("filters out metadata-only events (tool_use, etc)", () => {
      const f = createAgentOutputFilter();
      const chunk = '{"type":"tool_use","name":"edit","input":{}}\n';
      expect(f.filter(chunk)).toBe("");
    });

    it("handles multiple NDJSON lines in one chunk", () => {
      const f = createAgentOutputFilter();
      const chunk =
        '{"type":"text","text":"Line 1"}\n{"type":"text","text":"Line 2"}\n';
      expect(f.filter(chunk)).toBe("Line 1Line 2");
    });

    it("buffers incomplete JSON lines across chunks", () => {
      const f = createAgentOutputFilter();
      const part1 = '{"type":"text","text":"Hel';
      const part2 = 'lo"}\n';
      expect(f.filter(part1)).toBe("");
      expect(f.filter(part2)).toBe("Hello");
    });

    it("handles mixed plain text and JSON", () => {
      const f = createAgentOutputFilter();
      const chunk = "Starting...\n" + '{"type":"text","text":"JSON content"}\n';
      // "Starting...\n" is not valid JSON, so it passes through
      expect(f.filter(chunk)).toContain("Starting...");
      expect(f.filter(chunk)).toContain("JSON content");
    });

    it("handles empty chunk", () => {
      const f = createAgentOutputFilter();
      expect(f.filter("")).toBe("");
    });

    it("resets buffer when reset is called", () => {
      const f = createAgentOutputFilter();
      f.filter('{"type":"text","text":"Par');
      f.reset();
      // After reset, buffer is empty; 'tial"}' is invalid JSON, so it passes through as plain text
      expect(f.filter('tial"}\n')).toBe('tial"}\n');
    });

    it("clears buffer so next chunk starts fresh after reset", () => {
      const f = createAgentOutputFilter();
      f.filter('{"type":"text","text":"First"}\n');
      f.reset();
      expect(f.filter('{"type":"text","text":"Second"}\n')).toBe("Second");
    });

    it("isolates buffer between instances", () => {
      const f1 = createAgentOutputFilter();
      const f2 = createAgentOutputFilter();
      f1.filter('{"type":"text","text":"Hel');
      f2.filter('lo"}\n');
      // f1 has incomplete buffer, f2 has complete line
      expect(f1.filter('lo"}\n')).toBe("Hello");
      expect(f2.filter('{"type":"text","text":"Other"}\n')).toBe("Other");
    });
  });
});
