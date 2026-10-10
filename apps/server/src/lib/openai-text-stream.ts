import { z } from "zod";

const chunkSchema = z.object({
  error: z.object({ message: z.string() }).optional(),
  choices: z.array(z.object({
    delta: z.object({ content: z.string().nullable().optional() }).optional(),
  })).optional(),
});

// Keep reading through comments, role-only and reasoning chunks until text arrives.
// Returning from pull without enqueueing can leave the downstream reader waiting.
export function OpenaiTextStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  async function* readText() {
    let buffer = "";
    let hasText = false;
    try {
      while (true) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Model stream timed out")), 60_000);
          }),
        ]).finally(() => clearTimeout(timer));
        buffer += result.done ? decoder.decode() : decoder.decode(result.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        if (result.done && buffer) {
          lines.push(buffer);
          buffer = "";
        }
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") {
            if (!hasText) throw new Error("Model returned no text");
            return;
          }
          const chunk = chunkSchema.parse(JSON.parse(data));
          if (chunk.error) throw new Error(chunk.error.message);
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) {
            hasText = true;
            yield encoder.encode(text);
          }
        }
        if (result.done) {
          if (!hasText) throw new Error("Model returned no text");
          return;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  const iterator = readText();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        console.error("[AI /llm-test]", error instanceof Error ? error.message : "Stream failed");
        controller.error(error);
      }
    },
    async cancel() {
      await reader.cancel().catch(() => undefined);
      await iterator.return();
    },
  });
}
