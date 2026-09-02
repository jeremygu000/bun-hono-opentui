import { Hono } from "hono";
import { streamText } from "ai";
import { createUIMessageStreamResponse, toUIMessageStream } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: Bun.env.OPENAI_API_KEY,
});

export const app = new Hono()
  .get("/", (c) => c.json({ message: `Welcome to ${JEREMYCODE_NAME}` }))
  .get("/health", (c) => c.json({ status: "ok" }))
  .post("/api/llm", async (c) => {
    const { prompt } = await c.req.json<{ prompt?: string }>();
    const q = prompt ?? "Say hi in one short sentence.";
    const result = streamText({
      model: openrouter.chat("minimax/minimax-m3:free"),
      prompt: q,
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  });

export type AppType = typeof app;
