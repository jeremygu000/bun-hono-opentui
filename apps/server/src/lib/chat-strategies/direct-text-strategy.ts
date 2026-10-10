import { HTTPException } from "hono/http-exception";
import { OpenaiTextStream } from "./direct-text-strategy.util";
import type { ChatHandler, DirectStrategyDependencies } from "./types";

// No AI SDK invocation: build the OpenAI-compatible request ourselves,
// parse upstream SSE with OpenaiTextStream, and send plain text to the CLI.
export function createDirectTextStrategy({ config, fetchUpstream = fetch }: DirectStrategyDependencies): ChatHandler {
  return async (input, signal) => {
    const messages = "prompt" in input
      ? [{ role: "user", content: input.prompt }]
      : input.messages.map((message) => {
        if (!message.parts.length || message.parts.some((part) => part.type !== "text")) {
          throw new HTTPException(400, {
            message: "direct-text only supports messages with text parts",
          });
        }
        return {
          role: message.role,
          content: message.parts.map((part) => part.type === "text" ? part.text : "").join(""),
        };
      });

    const upstream = await fetchUpstream(`${config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        ...(config.provider === "openrouter" ? { reasoning: { enabled: false } } : {}),
        messages,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    });

    if (!upstream.ok || !upstream.body) {
      return new Response(await upstream.text(), { status: upstream.ok ? 502 : upstream.status });
    }
    return new Response(OpenaiTextStream(upstream.body), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  };
}
