import { DefaultChatTransport, TextStreamChatTransport } from "ai";
import { chatBodySchema, type ChatStrategy } from "@bun-hono-opentui/shared";
import { api } from "./client";
import { chatStrategy } from "./chat-config";

// Both SDK hooks provide fetch-shaped requests. Validate their body and use
// typed Hono RPC so URLs and JSON serialization stay in the client layer.
export const chatFetch: typeof fetch = Object.assign(async (_url: RequestInfo | URL, init?: RequestInit) => {
  const raw: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  const parsed = chatBodySchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid chat request");
  const response = await api.chat.$post({ json: parsed.data }, { init: { signal: init?.signal } });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}, { preconnect: fetch.preconnect });

export function createChatTransport(strategy: ChatStrategy = chatStrategy) {
  const options = {
    api: api.chat.$url().toString(),
    body: { strategy },
    fetch: chatFetch,
  };
  return strategy === "sdk-ui"
    ? new DefaultChatTransport(options)
    : new TextStreamChatTransport(options);
}
