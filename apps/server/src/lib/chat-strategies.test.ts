import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { createApp } from "../app";
import { createChatStrategies } from "./chat-strategies";

const config = { provider: "openrouter", baseURL: "https://example.test/v1", apiKey: "test", model: "mock-model" };

function mockModel(fail = false) {
  return new MockLanguageModelV4({
    modelId: config.model,
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "response-metadata", id: "test-response", modelId: config.model });
          controller.enqueue({ type: "text-start", id: "text-1" });
          controller.enqueue({ type: "text-delta", id: "text-1", delta: "你好" });
          if (fail) controller.enqueue({ type: "error", error: new Error("Provider failed") });
          controller.enqueue({ type: "text-end", id: "text-1" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          });
          controller.close();
        },
      }),
    }),
  });
}

function post(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

const history = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "First" }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "Answer" }] },
  { id: "u2", role: "user", parts: [{ type: "text", text: "Follow-up" }] },
];

for (const strategy of ["sdk-ui", "sdk-text"] as const) {
  test(`${strategy} accepts prompt and preserves multi-turn history`, async () => {
    const model = mockModel();
    const app = createApp(createChatStrategies({ model, config }));
    for (const input of [{ prompt: "Hello" }, { messages: history }]) {
      const response = await post(app, { strategy, ...input });
      expect(response.status).toBe(200);
      const text = await response.text();
      if (strategy === "sdk-ui") {
        expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
        expect(text).toContain('"type":"text-delta"');
        expect(text).toContain("你好");
        expect(text).toContain("[DONE]");
      } else {
        expect(response.headers.get("Content-Type")).toContain("text/plain");
        expect(text).toBe("你好");
      }
    }
    expect(model.doStreamCalls[1]?.prompt.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
  });
}

test("direct-text translates prompt and history into OpenAI-compatible requests", async () => {
  const requests: unknown[] = [];
  const fetchUpstream: typeof fetch = Object.assign(async (_url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n');
  }, { preconnect: fetch.preconnect });
  const app = createApp(createChatStrategies({ model: mockModel(), config, fetchUpstream }));
  for (const input of [{ prompt: "Hello" }, { messages: history }]) {
    const response = await post(app, { strategy: "direct-text", ...input });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("你好");
  }
  expect(requests).toEqual([
    { model: config.model, stream: true, reasoning: { enabled: false }, messages: [{ role: "user", content: "Hello" }] },
    { model: config.model, stream: true, reasoning: { enabled: false }, messages: [
      { role: "user", content: "First" }, { role: "assistant", content: "Answer" }, { role: "user", content: "Follow-up" },
    ] },
  ]);
});

test("invalid inputs fail before model invocation; omitted strategy defaults to sdk-ui", async () => {
  const model = mockModel();
  const app = createApp(createChatStrategies({ model, config }));
  for (const body of [
    {}, { prompt: "" }, { strategy: "unknown", prompt: "Hello" },
    { prompt: "Hello", messages: history }, { messages: [{}] }, { messages: [] },
    { strategy: "direct-text", messages: [{ id: "u1", role: "user", parts: [{ type: "file", mediaType: "image/png", url: "https://example.test/image.png" }] }] },
  ]) {
    expect((await post(app, body)).status).toBe(400);
  }
  expect(model.doStreamCalls).toHaveLength(0);
  const response = await post(app, { prompt: "Hello" });
  expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
  await response.text();
  expect((await app.request("/health")).status).toBe(200);
  expect((await app.request("/api/chat", { method: "POST" })).status).toBe(404);
});

test("SDK text strategy surfaces in-band errors rather than returning truncated success", async () => {
  const app = createApp(createChatStrategies({ model: mockModel(true), config }));
  const response = await post(app, { strategy: "sdk-text", prompt: "Hello" });
  await expect(response.text()).rejects.toThrow("Provider failed");
});

test("direct-text preserves upstream HTTP errors", async () => {
  const fetchUpstream: typeof fetch = Object.assign(async () => new Response("Rate limited", { status: 429 }), { preconnect: fetch.preconnect });
  const app = createApp(createChatStrategies({ model: mockModel(), config, fetchUpstream }));
  const response = await post(app, { strategy: "direct-text", prompt: "Hello" });
  expect(response.status).toBe(429);
  expect(await response.text()).toBe("Rate limited");
});
