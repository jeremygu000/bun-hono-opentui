import { expect, test } from "bun:test";
import { OpenaiTextStream } from "./openai-text-stream";

function upstream(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++]));
      else controller.close();
    },
  });
}

const text = (value: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: value } }] })}\n\n`;

test("continues through comment, role-only and reasoning chunks", async () => {
  const body = upstream([
    ": keepalive\n\n",
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning":"thinking"}}]}\n\n',
    text("OK"),
    "data: [DONE]\n\n",
  ]);
  expect(await new Response(OpenaiTextStream(body)).text()).toBe("OK");
});

test("handles fragmented events and a final line without a newline", async () => {
  const event = text("你好");
  const body = upstream([event.slice(0, 9), event.slice(9), "data: [DONE]"]);
  expect(await new Response(OpenaiTextStream(body)).text()).toBe("你好");
});

test("surfaces upstream error events even when HTTP status was 200", async () => {
  const body = upstream(['data: {"error":{"message":"Provider overloaded"}}\n\n']);
  expect(new Response(OpenaiTextStream(body)).text()).rejects.toThrow("Provider overloaded");
});

test("rejects empty completions", async () => {
  const body = upstream(["data: [DONE]\n\n"]);
  expect(new Response(OpenaiTextStream(body)).text()).rejects.toThrow("Model returned no text");
});
