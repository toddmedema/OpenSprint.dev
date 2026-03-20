import { agentService } from "./agent.service.js";
import type {
  AgentTrackingInfo,
  InvokePlanningAgentOptions,
  PlanningMessage,
} from "./agent.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("structured-agent-output");

export interface StructuredOutputContract<T> {
  parse(content: string): T | null;
  repairPrompt: string;
  invalidReason?: (content: string) => string | undefined;
  onExhausted?: (params: {
    initialRawContent: string;
    repairRawContent: string;
    invalidReason?: string;
  }) => T | null;
}

export interface StructuredOutputResult<T> {
  ok: boolean;
  parsed: T | null;
  initialRawContent: string;
  rawContent: string;
  repairRawContent?: string;
  repaired: boolean;
  attempts: 1 | 2;
  exhausted: boolean;
  fallbackApplied: boolean;
  invalidReason?: string;
}

export interface InvokeStructuredPlanningAgentOptions<T>
  extends Omit<InvokePlanningAgentOptions, "messages"> {
  messages: PlanningMessage[];
  contract: StructuredOutputContract<T>;
}

function buildRepairMessages(
  originalMessages: PlanningMessage[],
  invalidContent: string,
  repairPrompt: string,
  invalidReason?: string
): PlanningMessage[] {
  const messages = originalMessages.map((message) => ({ ...message }));
  if (invalidContent.trim()) {
    messages.push({ role: "assistant", content: invalidContent });
  }
  const reasonLine = invalidReason?.trim()
    ? `Previous parse failure: ${invalidReason.trim()}\n\n`
    : "";
  messages.push({
    role: "user",
    content:
      "Your previous response did not match the required structured-output contract.\n\n" +
      reasonLine +
      repairPrompt.trim() +
      "\n\nReturn only the required structured output.",
  });
  return messages;
}

function buildRepairTracking(tracking?: AgentTrackingInfo): AgentTrackingInfo | undefined {
  if (!tracking) return undefined;
  return {
    ...tracking,
    id: `${tracking.id}-repair`,
  };
}

function getResponseContent(response: { content?: string | null } | null | undefined): string {
  return typeof response?.content === "string" ? response.content : "";
}

export async function invokeStructuredPlanningAgent<T>(
  options: InvokeStructuredPlanningAgentOptions<T>
): Promise<StructuredOutputResult<T>> {
  const { contract, messages, ...invokeOptions } = options;

  const initialResponse = await agentService.invokePlanningAgent({
    ...invokeOptions,
    messages,
  });
  const initialRawContent = getResponseContent(initialResponse);
  const initialParsed = contract.parse(initialRawContent);
  if (initialParsed) {
    return {
      ok: true,
      parsed: initialParsed,
      initialRawContent,
      rawContent: initialRawContent,
      repaired: false,
      attempts: 1,
      exhausted: false,
      fallbackApplied: false,
    };
  }

  const initialInvalidReason = contract.invalidReason?.(initialRawContent);
  log.warn("Structured planning output invalid; retrying once", {
    projectId: invokeOptions.projectId,
    role: invokeOptions.role,
    trackingId: invokeOptions.tracking?.id,
    invalidReason: initialInvalidReason,
  });

  const repairMessages = buildRepairMessages(
    messages,
    initialRawContent,
    contract.repairPrompt,
    initialInvalidReason
  );
  const repairResponse = await agentService.invokePlanningAgent({
    ...invokeOptions,
    messages: repairMessages,
    tracking: buildRepairTracking(invokeOptions.tracking),
  });
  const repairRawContent = getResponseContent(repairResponse);
  const repairParsed = contract.parse(repairRawContent);
  if (repairParsed) {
    return {
      ok: true,
      parsed: repairParsed,
      initialRawContent,
      rawContent: repairRawContent,
      repairRawContent,
      repaired: true,
      attempts: 2,
      exhausted: false,
      fallbackApplied: false,
    };
  }

  const repairInvalidReason = contract.invalidReason?.(repairRawContent);
  const invalidReason =
    repairRawContent.trim().length > 0 ? repairInvalidReason ?? initialInvalidReason : initialInvalidReason;
  const fallback = contract.onExhausted?.({
    initialRawContent,
    repairRawContent,
    invalidReason,
  });
  const finalRawContent = repairRawContent || initialRawContent;
  return {
    ok: false,
    parsed: fallback ?? null,
    initialRawContent,
    rawContent: finalRawContent,
    repairRawContent,
    repaired: true,
    attempts: 2,
    exhausted: true,
    fallbackApplied: fallback != null,
    invalidReason,
  };
}
