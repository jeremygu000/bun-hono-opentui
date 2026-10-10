import { safeValidateUIMessages, type UIMessage } from "ai";
import { HTTPException } from "hono/http-exception";
import type { ChatBody } from "@bun-hono-opentui/shared";

export type ChatInput = { prompt: string } | { messages: UIMessage[] };

export async function parseChatInput(body: ChatBody): Promise<ChatInput> {
  if (body.prompt !== undefined) return { prompt: body.prompt };

  const parsed = await safeValidateUIMessages({ messages: body.messages });
  if (!parsed.success) {
    throw new HTTPException(400, { message: "Invalid UIMessage history" });
  }
  return { messages: parsed.data };
}
