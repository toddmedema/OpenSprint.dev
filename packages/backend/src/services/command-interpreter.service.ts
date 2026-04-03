/**
 * NL command interpreter — parses natural language input into structured
 * CommandIntent payloads with risk classification.
 */

import type {
  CommandIntent,
  CommandInterpretation,
  CommandRiskLevel,
} from "@opensprint/shared";

/** Pattern-based intent extraction rules. */
interface IntentPattern {
  patterns: RegExp[];
  extract: (match: RegExpMatchArray, input: string) => CommandIntent;
  risk: CommandRiskLevel;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    patterns: [
      /^(?:list|show|get)\s+(?:intake|inbox)\s*(?:items?)?\s*(?:(?:from|for)\s+(\w+))?\s*(?:(?:with\s+)?status\s+(\w+))?/i,
    ],
    extract: (match) => ({
      commandType: "list_intake",
      args: {
        provider: match[1] || undefined,
        triageStatus: match[2] || undefined,
      },
    }),
    risk: "safe",
  },
  {
    patterns: [
      /^(?:convert|import)\s+(?:intake\s+)?(?:items?\s+)?(.+?)(?:\s+to\s+(?:feedback|task)s?)?$/i,
    ],
    extract: (match) => ({
      commandType: "convert_intake",
      args: {
        itemIds: match[1]?.split(/[,\s]+/).filter(Boolean) ?? [],
        action: "to_feedback",
      },
    }),
    risk: "mutating-low-risk",
  },
  {
    patterns: [
      /^(?:start|run|execute|begin)\s+(?:execution\s+)?(?:on\s+)?(?:all\s+)?(?:unblocked\s+)?tasks?\s*(?:(?:in|for|from)\s+(?:epic\s+)?(.+))?$/i,
    ],
    extract: (match) => ({
      commandType: "start_execute",
      args: {
        epicId: match[1]?.trim() || undefined,
      },
    }),
    risk: "mutating-high-risk",
  },
  {
    patterns: [
      /^(?:pause|stop|disable)\s+(\w+)\s+(?:integration|intake|sync)/i,
    ],
    extract: (match) => ({
      commandType: "pause_integration",
      args: { provider: match[1].toLowerCase() },
    }),
    risk: "mutating-low-risk",
  },
  {
    patterns: [
      /^(?:resume|enable|restart)\s+(\w+)\s+(?:integration|intake|sync)/i,
    ],
    extract: (match) => ({
      commandType: "resume_integration",
      args: { provider: match[1].toLowerCase() },
    }),
    risk: "mutating-low-risk",
  },
  {
    patterns: [
      /^(?:list|show|get)\s+tasks?\s*(?:(?:with\s+)?status\s+(\w+))?\s*(?:(?:in|for|from)\s+(?:epic\s+)?(.+))?$/i,
    ],
    extract: (match) => ({
      commandType: "list_tasks",
      args: {
        status: match[1] || undefined,
        epicId: match[2]?.trim() || undefined,
      },
    }),
    risk: "safe",
  },
  {
    patterns: [
      /^(?:create|add|new)\s+task\s+["""](.+?)["""]\s*(?:(?:in|under|for)\s+(.+))?$/i,
      /^(?:create|add|new)\s+task\s+(.+?)$/i,
    ],
    extract: (match) => ({
      commandType: "create_task",
      args: {
        title: match[1].trim(),
        parentId: match[2]?.trim() || undefined,
      },
    }),
    risk: "mutating-low-risk",
  },
  {
    patterns: [
      /^(?:sync|trigger\s+sync|run\s+sync)\s+(\w+)\s*(?:integration)?$/i,
    ],
    extract: (match) => ({
      commandType: "sync_integration",
      args: { provider: match[1].toLowerCase() },
    }),
    risk: "mutating-low-risk",
  },
  {
    patterns: [
      /^(?:show|get|what(?:'s| is))\s+(?:the\s+)?(?:project\s+)?status$/i,
    ],
    extract: () => ({
      commandType: "show_project_status",
      args: {},
    }),
    risk: "safe",
  },
];

export class CommandInterpreterService {
  interpret(input: string): CommandInterpretation {
    const trimmed = input.trim();

    for (const rule of INTENT_PATTERNS) {
      for (const pattern of rule.patterns) {
        const match = trimmed.match(pattern);
        if (match) {
          const intent = rule.extract(match, trimmed);
          return {
            intent,
            confidence: 0.85,
            riskLevel: rule.risk,
          };
        }
      }
    }

    return {
      intent: {
        commandType: "unrecognized",
        args: {
          rawInput: trimmed,
          suggestion: "Try commands like: list intake items, show tasks, create task, sync todoist, show project status",
        },
      },
      confidence: 0,
      clarificationNeeded: `Could not interpret: "${trimmed}". Try a more specific command.`,
      riskLevel: "safe",
    };
  }
}

export const commandInterpreter = new CommandInterpreterService();
