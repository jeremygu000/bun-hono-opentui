import { Hono } from "hono";
import { streamText } from "ai";
import { createTextStreamResponse, toTextStream } from "ai";
import { createUIMessageStreamResponse, toUIMessageStream } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";
import { promptSchema } from "./schema";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: Bun.env.OPENAI_API_KEY,
});

async function readPrompt(c: { req: { json: () => Promise<unknown> } }) {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = promptSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "invalid body" } as const;
  }
  return { prompt: parsed.data.prompt } as const;
}

export const app = new Hono()
  .get("/", (c) => c.json({ message: `Welcome to ${JEREMYCODE_NAME}` }))
  .get("/health", (c) => c.json({ status: "ok" }))
  .post("/api/llm", async (c) => {
    const body = await readPrompt(c);
    if ("error" in body) return c.json({ error: body.error }, 400);
    const result = streamText({
      model: openrouter.chat("minimax/minimax-m3:free"),
      prompt: body.prompt,
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  })
  .post("/llm-test", async (c) => {
    const body = await readPrompt(c);
    if ("error" in body) return c.json({ error: body.error }, 400);
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Bun.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "minimax/minimax-m3:free",
        stream: true,
        messages: [{ role: "user", content: body.prompt }],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      return new Response(await upstream.text(), { status: upstream.status });
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    const reader = upstream.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") {
            controller.close();
            return;
          }

          const text = JSON.parse(data).choices?.[0]?.delta?.content;
          if (text) controller.enqueue(encoder.encode(text));
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  })
  .post("/llm-hybrid", async (c) => {
    const body = await readPrompt(c);
    if ("error" in body) return c.json({ error: body.error }, 400);
    const result = streamText({
      model: openrouter.chat("minimax/minimax-m3:free"),
      prompt: body.prompt,
    });
    return createTextStreamResponse({
      stream: toTextStream({ stream: result.stream }),
    });
  });

export type AppType = typeof app;
