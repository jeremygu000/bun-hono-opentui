import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { OpenaiTextStream } from "./lib/openai-text-stream";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { createTextStreamResponse, toTextStream } from "ai";
import { createUIMessageStreamResponse, toUIMessageStream } from "ai";
import { aiConfig, aiModel } from "./lib/ai-config";
import { chatBodySchema, JEREMYCODE_NAME, promptSchema } from "@bun-hono-opentui/shared";

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
      model: aiModel,
      prompt: body.prompt,
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  })
  .post("/llm-test", zValidator("json", promptSchema), async (c) => {
    const body = c.req.valid("json");
    const upstream = await fetch(`${aiConfig.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiConfig.model,
        stream: true,
        ...(aiConfig.provider === "openrouter" ? { reasoning: { enabled: false } } : {}),
        messages: [{ role: "user", content: body.prompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!upstream.ok || !upstream.body) {
      return new Response(await upstream.text(), { status: upstream.ok ? 502 : upstream.status });
    }

    return new Response(OpenaiTextStream(upstream.body), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  })
  .post("/llm-hybrid", zValidator("json", promptSchema), async (c) => {
    const body = c.req.valid("json");
    const result = streamText({
      model: aiModel,
      prompt: body.prompt,
    });
    return createTextStreamResponse({
      stream: toTextStream({ stream: result.stream }),
    });
  })
  .post("/api/chat", async (c) => {
    const raw = await c.req.json().catch(() => undefined);
    const parsed = chatBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
    }
    const modelMessages = await convertToModelMessages(parsed.data.messages as UIMessage[]);
    const result = streamText({
      model: aiModel,
      messages: modelMessages,
      onEnd: ({ response }) => {
        const matches = response.modelId === aiConfig.model;
        const message = `[AI /api/chat] provider=${aiConfig.provider} requestedModel=${aiConfig.model} responseModel=${response.modelId} modelIdMatch=${matches} responseId=${response.id}`;
        if (matches) console.log(message);
        else console.warn(message);
      },
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  });

export type AppType = typeof app;
