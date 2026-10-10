import { convertToModelMessages, streamText, type LanguageModel } from "ai";
import { HTTPException } from "hono/http-exception";
import type { ChatStrategy } from "@bun-hono-opentui/shared";
import type { ChatInput } from "./chat-input";
import { chatResponseStrategies } from "./chat-response-strategies";
import { OpenaiTextStream } from "./openai-text-stream";

type ChatConfig = {
  provider: string;
  baseURL: string;
  apiKey: string | undefined;
  model: string;
};

type ChatHandler = (input: ChatInput, signal: AbortSignal) => Promise<Response>;

export function createChatStrategies({
  model,
  config,
  fetchUpstream = fetch,
}: {
  model: LanguageModel;
  config: ChatConfig;
  fetchUpstream?: typeof fetch;
}): Record<ChatStrategy, ChatHandler> {
  function sdk(responseStrategy: keyof typeof chatResponseStrategies): ChatHandler {
    return async (input, signal) => {
      const modelInput = "prompt" in input
        ? { prompt: input.prompt }
        : { messages: await convertToModelMessages(input.messages) };
      const result = streamText({
        model,
        ...modelInput,
        abortSignal: signal,
        onEnd: ({ response }) => {
          const matches = response.modelId === config.model;
          const message = `[AI /chat] provider=${config.provider} requestedModel=${config.model} responseModel=${response.modelId} modelIdMatch=${matches} responseId=${response.id}`;
          if (matches) console.log(message);
          else console.warn(message);
        },
      });
      return chatResponseStrategies[responseStrategy](result.stream);
    };
  }

  const directText: ChatHandler = async (input, signal) => {
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

  return {
    "sdk-ui": sdk("ui"),
    "direct-text": directText,
    "sdk-text": sdk("text"),
  };
}
