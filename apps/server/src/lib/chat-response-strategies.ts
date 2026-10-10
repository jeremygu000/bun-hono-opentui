import {
  createTextStreamResponse,
  createUIMessageStreamResponse,
  toTextStream,
  toUIMessageStream,
  type streamText,
} from "ai";

type ModelStream = ReturnType<typeof streamText>["stream"];
type ResponseStrategy = (stream: ModelStream) => Response;

export const chatResponseStrategies = {
  ui: (stream) => createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream }),
  }),
  text: (stream) => createTextStreamResponse({
    // Plain text has no error envelope: fail the stream instead of silently
    // filtering SDK error parts and presenting an incomplete answer as success.
    stream: toTextStream({
      stream: stream.pipeThrough(new TransformStream({
        transform(part, controller) {
          if (part.type === "error") {
            throw part.error instanceof Error ? part.error : new Error("Model stream failed");
          }
          controller.enqueue(part);
        },
      })),
    }),
  }),
} satisfies Record<string, ResponseStrategy>;
