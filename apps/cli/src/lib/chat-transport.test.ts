import { expect, test } from "bun:test";
import { createApp } from "@bun-hono-opentui/server/app";
import { createChatTransport, chatFetch } from "./chat-transport";

test("all three transports send typed /chat requests and decode the matching protocol", async () => {
  const originalFetch = globalThis.fetch;
  const inputs: unknown[] = [];
  const app = createApp({
    "sdk-ui": async (input) => {
      inputs.push(input);
      return new Response([
        'data: {"type":"start","messageId":"a1"}\n\n',
        'data: {"type":"text-start","id":"t1"}\n\n',
        'data: {"type":"text-delta","id":"t1","delta":"你好"}\n\n',
        'data: {"type":"text-end","id":"t1"}\n\n',
        'data: {"type":"finish"}\n\n',
        'data: [DONE]\n\n',
      ].join(""), { headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } });
    },
    "sdk-text": async (input) => { inputs.push(input); return new Response("你好"); },
    "direct-text": async (input) => { inputs.push(input); return new Response("你好"); },
  });
  globalThis.fetch = Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(url, init);
    expect(new URL(request.url).pathname).toBe("/chat");
    return app.fetch(request);
  }, { preconnect: originalFetch.preconnect });

  try {
    for (const strategy of ["sdk-ui", "direct-text", "sdk-text"] as const) {
      const transport = createChatTransport(strategy);
      const stream = await transport.sendMessages({
        chatId: "test-chat", trigger: "submit-message", messageId: undefined,
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
        abortSignal: new AbortController().signal,
      });
      let text = "";
      for await (const chunk of stream) {
        if (chunk.type === "text-delta") text += chunk.delta;
      }
      expect(text).toBe("你好");
    }
    expect(inputs).toHaveLength(3);
    const response = await chatFetch("unused", {
      body: JSON.stringify({ strategy: "sdk-text", prompt: "Single prompt" }),
    });
    expect(await response.text()).toBe("你好");
    expect(inputs[3]).toEqual({ prompt: "Single prompt" });
    await expect(chatFetch("unused", { body: JSON.stringify({ strategy: "invalid", prompt: "Hello" }) })).rejects.toThrow();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
