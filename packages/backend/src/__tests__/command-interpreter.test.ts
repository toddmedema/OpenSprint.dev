import { describe, it, expect } from "vitest";
import { commandInterpreter } from "../services/command-interpreter.service.js";

describe("CommandInterpreterService", () => {
  describe("list commands", () => {
    it("parses 'list intake items'", () => {
      const result = commandInterpreter.interpret("list intake items");
      expect(result.intent.commandType).toBe("list_intake");
      expect(result.riskLevel).toBe("safe");
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("parses 'show intake from github'", () => {
      const result = commandInterpreter.interpret("show intake from github");
      expect(result.intent.commandType).toBe("list_intake");
      if (result.intent.commandType === "list_intake") {
        expect(result.intent.args.provider).toBe("github");
      }
    });

    it("parses 'list tasks'", () => {
      const result = commandInterpreter.interpret("list tasks");
      expect(result.intent.commandType).toBe("list_tasks");
      expect(result.riskLevel).toBe("safe");
    });

    it("parses 'show tasks with status open'", () => {
      const result = commandInterpreter.interpret("show tasks with status open");
      expect(result.intent.commandType).toBe("list_tasks");
      if (result.intent.commandType === "list_tasks") {
        expect(result.intent.args.status).toBe("open");
      }
    });
  });

  describe("mutating commands", () => {
    it("parses 'create task Fix the login bug'", () => {
      const result = commandInterpreter.interpret('create task "Fix the login bug"');
      expect(result.intent.commandType).toBe("create_task");
      expect(result.riskLevel).toBe("mutating-low-risk");
      if (result.intent.commandType === "create_task") {
        expect(result.intent.args.title).toBe("Fix the login bug");
      }
    });

    it("parses 'sync todoist integration'", () => {
      const result = commandInterpreter.interpret("sync todoist integration");
      expect(result.intent.commandType).toBe("sync_integration");
      if (result.intent.commandType === "sync_integration") {
        expect(result.intent.args.provider).toBe("todoist");
      }
    });

    it("parses 'pause slack integration'", () => {
      const result = commandInterpreter.interpret("pause slack integration");
      expect(result.intent.commandType).toBe("pause_integration");
      if (result.intent.commandType === "pause_integration") {
        expect(result.intent.args.provider).toBe("slack");
      }
    });

    it("parses 'resume github integration'", () => {
      const result = commandInterpreter.interpret("resume github integration");
      expect(result.intent.commandType).toBe("resume_integration");
      if (result.intent.commandType === "resume_integration") {
        expect(result.intent.args.provider).toBe("github");
      }
    });
  });

  describe("high-risk commands", () => {
    it("parses 'start execution on all tasks'", () => {
      const result = commandInterpreter.interpret("start execution on all tasks");
      expect(result.intent.commandType).toBe("start_execute");
      expect(result.riskLevel).toBe("mutating-high-risk");
    });
  });

  describe("status commands", () => {
    it("parses 'show project status'", () => {
      const result = commandInterpreter.interpret("show project status");
      expect(result.intent.commandType).toBe("show_project_status");
      expect(result.riskLevel).toBe("safe");
    });

    it("parses 'what is the project status'", () => {
      const result = commandInterpreter.interpret("what is the project status");
      expect(result.intent.commandType).toBe("show_project_status");
    });
  });

  describe("unrecognized commands", () => {
    it("returns unrecognized for gibberish", () => {
      const result = commandInterpreter.interpret("xyzzy foo bar baz");
      expect(result.intent.commandType).toBe("unrecognized");
      expect(result.confidence).toBe(0);
      expect(result.clarificationNeeded).toBeDefined();
    });

    it("includes suggestion in unrecognized output", () => {
      const result = commandInterpreter.interpret("do the thing");
      expect(result.intent.commandType).toBe("unrecognized");
      if (result.intent.commandType === "unrecognized") {
        expect(result.intent.args.suggestion).toBeDefined();
      }
    });
  });
});
