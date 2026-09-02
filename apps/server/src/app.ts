import { Hono } from "hono";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: Bun.env.OPENAI_API_KEY,
});

export const app = new Hono()
  .get("/", (c) => c.json({ message: `Welcome to ${JEREMYCODE_NAME}` }))
  .get("/health", (c) => c.json({ status: "ok" }))
  .get("/api/llm", async (c) => {
    const q = c.req.query("q") ?? "Say hi in one short sentence.";
    const { text } = await generateText({
      model: openrouter.chat("minimax/minimax-m2.7:free"),
      prompt: q,
    });
    console.log("Generated text:", text);
    return c.json({ prompt: q, text });
  });

export type AppType = typeof app;
