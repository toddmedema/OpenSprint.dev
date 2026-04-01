import {
  toOpenAIResponsesInputMessage,
  type OpenAIResponsesInputContent,
  type OpenAIResponsesInputMessage,
} from "../../utils/openai-models.js";
import type { PlanningMessage } from "./agent-types.js";

export function buildOpenAIPlanningResponsesInput(
  messages: PlanningMessage[],
  images?: string[]
): OpenAIResponsesInputMessage[] {
  return messages.map((message, index) => {
    const isLastUserMessage = message.role === "user" && index === messages.length - 1;
    const hasImages = isLastUserMessage && images && images.length > 0;
    if (!hasImages) {
      return toOpenAIResponsesInputMessage(message.role, message.content);
    }

    const content: OpenAIResponsesInputContent[] = [{ type: "input_text", text: message.content }];
    for (const image of images) {
      content.push({
        type: "input_image",
        image_url: image.startsWith("data:") ? image : `data:image/png;base64,${image}`,
        detail: "auto",
      });
    }
    return { role: "user", content };
  });
}

export type OpenAIResponsesStreamEvent = {
  type?: string;
  delta?: string;
  response?: {
    id?: string | null;
    usage?: {
      input_tokens_details?: { cached_tokens?: number | null } | null;
    } | null;
  } | null;
};

export async function collectOpenAIResponsesStream(
  stream: AsyncIterable<OpenAIResponsesStreamEvent>,
  onChunk: (chunk: string) => void
): Promise<{
  content: string;
  responseId?: string;
  usage?: {
    input_tokens_details?: { cached_tokens?: number | null } | null;
  } | null;
}> {
  let fullContent = "";
  let responseId: string | undefined;
  let usage:
    | {
        input_tokens_details?: { cached_tokens?: number | null } | null;
      }
    | null
    | undefined;
  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && event.delta) {
      fullContent += event.delta;
      onChunk(event.delta);
    }
    if (event.type === "response.completed" && event.response) {
      responseId = event.response.id ?? undefined;
      usage = event.response.usage;
    }
  }
  return { content: fullContent, responseId, usage };
}
