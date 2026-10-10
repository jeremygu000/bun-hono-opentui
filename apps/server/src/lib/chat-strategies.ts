import type { ChatStrategy } from "@bun-hono-opentui/shared";
import { createDirectTextStrategy } from "./chat-strategies/direct-text-strategy";
import { createSdkTextStrategy } from "./chat-strategies/sdk-text-strategy";
import { createSdkUiStrategy } from "./chat-strategies/sdk-ui-strategy";
import type { ChatHandler, ChatStrategyDependencies } from "./chat-strategies/types";

// Assembly only. Each strategy owns its invocation and response protocol.
export function createChatStrategies(dependencies: ChatStrategyDependencies): Record<ChatStrategy, ChatHandler> {
  return {
    "sdk-ui": createSdkUiStrategy(dependencies),       // AI SDK -> UIMessage SSE
    "direct-text": createDirectTextStrategy(dependencies), // fetch -> upstream SSE parser -> text
    "sdk-text": createSdkTextStrategy(dependencies),   // AI SDK -> text
  };
}
