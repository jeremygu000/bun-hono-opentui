import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { chatBodySchema, JEREMYCODE_NAME } from "@bun-hono-opentui/shared";
import { aiConfig, aiModel } from "./lib/ai-config";
import { parseChatInput } from "./lib/chat-input";
import { createChatStrategies } from "./lib/chat-strategies";

export function createApp(
  strategies = createChatStrategies({ model: aiModel, config: aiConfig }),
) {
  return new Hono()
    .get("/", (c) => c.json({ message: `Welcome to ${JEREMYCODE_NAME}` }))
    .get("/health", (c) => c.json({ status: "ok" }))
    .post("/chat", zValidator("json", chatBodySchema), async (c) => {
      const body = c.req.valid("json");
      const input = await parseChatInput(body);
      return strategies[body.strategy](input, c.req.raw.signal);
    });
}

export const app = createApp();
export type AppType = typeof app;
