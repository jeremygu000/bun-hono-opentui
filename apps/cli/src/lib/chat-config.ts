import { chatStrategySchema } from "@bun-hono-opentui/shared";

export const chatStrategy = chatStrategySchema.default("sdk-ui").parse(Bun.env.CHAT_STRATEGY);
export const completionStreamProtocol = chatStrategy === "sdk-ui" ? "data" : "text";
