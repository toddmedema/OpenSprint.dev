import { describe, it, expect } from "vitest";
import { createAgentOutputFilter, filterAgentOutput } from "../agent-output-filter.js";

describe("agent-output-filter", () => {
  describe("createAgentOutputFilter", () => {
    it("returns an instance with filter and reset methods", () => {
      const f = createAgentOutputFilter();
      expect(typeof f.filter).toBe("function");
      expect(typeof f.reset).toBe("function");
    });

    it("passes through plain text unchanged", () => {
      const f = createAgentOutputFilter();
      expect(f.filter("Hello world\n")).toBe("Hello world\n");
    });

    it("filters out type tool_call NDJSON", () => {
      const f = createAgentOutputFilter();
      const chunk =
        '{"type":"text","text":"Before"}\n' +
        '{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{}}\n' +
        '{"type":"text","text":"After"}\n';
      expect(f.filter(chunk)).toBe("BeforeAfter");
    });

    it("filters out code-context entries (lineNumber/content/isContextLine)", () => {
      const f = createAgentOutputFilter();
      const chunk =
        '{"type":"text","text":"Visible"}\n' +
        '{"lineNumber":1,"content":"const x = 1;","isContextLine":true}\n' +
        '{"type":"text","text":"Done"}\n';
      expect(f.filter(chunk)).toBe("VisibleDone");
    });

    it("filters out lines containing onOutput", () => {
      const f = createAgentOutputFilter();
      const chunk =
        '{"type":"text","text":"OK"}\n' +
        '{"type":"message","content":"callback onOutput(chunk) was invoked"}\n' +
        '{"type":"text","text":"End"}\n';
      expect(f.filter(chunk)).toBe("OKEnd");
    });

    it("filters out lines containing ingestOutputChunk", () => {
      const f = createAgentOutputFilter();
      const chunk = "ingestOutputChunk(runState, chunk);\n";
      expect(f.filter(chunk)).toBe("");
    });

    it("extracts text from type text NDJSON", () => {
      const f = createAgentOutputFilter();
      expect(f.filter('{"type":"text","text":"Hello from agent"}\n')).toBe("Hello from agent");
    });

    it("inserts a newline between consecutive assistant messages", () => {
      const f = createAgentOutputFilter();
      const chunk =
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Lint passes."}]}}\n' +
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Let me check on the test output."}]}}\n';
      expect(f.filter(chunk)).toBe("Lint passes.\nLet me check on the test output.");
    });

    it("filters out metadata-only events (tool_use)", () => {
      const f = createAgentOutputFilter();
      expect(f.filter('{"type":"tool_use","name":"edit","input":{}}\n')).toBe("");
    });
  });

  describe("filterAgentOutput", () => {
    it("filters full NDJSON in one pass", () => {
      const raw = '{"type":"text","text":"Hello"}\n{"type":"text","text":" world"}\n';
      expect(filterAgentOutput(raw)).toBe("Hello world");
    });

    it("filters out tool_call and code-context in one pass", () => {
      const raw =
        '{"type":"text","text":"Start"}\n' +
        '{"type":"tool_call","subtype":"started","call_id":"x"}\n' +
        '{"lineNumber":10,"content":"code","isContextLine":true}\n' +
        '{"type":"text","text":"End"}\n';
      expect(filterAgentOutput(raw)).toBe("StartEnd");
    });

    it("returns empty string for empty input", () => {
      expect(filterAgentOutput("")).toBe("");
    });

    it("passes through plain diagnostic text unchanged when it has no credentials", () => {
      const raw = "Plain text output\nNo JSON here\n";
      expect(filterAgentOutput(raw)).toBe("Plain text output\nNo JSON here\n");
    });

    it("redacts secrets in plain-text lines", () => {
      const raw = "curl -H 'Authorization: Bearer sk-not-real-key-012345678901234567890'\n";
      const out = filterAgentOutput(raw);
      expect(out).not.toMatch(/sk-not-real-key-012345678901234567890/);
      expect(out).toMatch(/Authorization:\s*\[REDACTED\]/i);
    });

    it("redacts secrets inside extracted NDJSON text payloads", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const raw = `${JSON.stringify({ type: "text", text: `token ${jwt}\n` })}\n`;
      const out = filterAgentOutput(raw);
      expect(out).not.toContain(jwt);
      expect(out).toContain("[REDACTED_JWT]");
    });

    it("keeps one line break between assistant messages in full-pass mode", () => {
      const raw =
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"First update"}]}}\n' +
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Second update"}]}}\n';
      expect(filterAgentOutput(raw)).toBe("First update\nSecond update");
    });
  });
});
