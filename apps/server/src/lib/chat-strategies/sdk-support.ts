import { convertToModelMessages } from "ai";
import type { ChatInput } from "../chat-input";
import type { ChatConfig } from "./types";

// Shared input conversion only; each strategy calls streamText itself.
export async function prepareSdkInput(input: ChatInput) {
  return "prompt" in input
    ? { prompt: input.prompt }
    : { messages: await convertToModelMessages(input.messages) };
}

export function logModelResponse(config: ChatConfig, response: { modelId: string; id: string }) {
  const matches = response.modelId === config.model;
  const message = `[AI /chat] provider=${config.provider} requestedModel=${config.model} responseModel=${response.modelId} modelIdMatch=${matches} responseId=${response.id}`;
  if (matches) console.log(message);
  else console.warn(message);
}
