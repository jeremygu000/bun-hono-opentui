import { createTextStreamResponse, streamText, toTextStream } from "ai";
import { logModelResponse, prepareSdkInput } from "./sdk-support";
import type { ChatHandler, SdkStrategyDependencies } from "./types";

// Same AI SDK invocation as sdk-ui -> plain text instead of UIMessage SSE.
// Unlike direct-text, AI SDK still handles the upstream provider protocol.
export function createSdkTextStrategy({ model, config }: SdkStrategyDependencies): ChatHandler {
  return async (input, signal) => {
    const modelInput = await prepareSdkInput(input);
    const result = streamText({
      model,
      ...modelInput,
      abortSignal: signal,
      onEnd: ({ finalStep }) => logModelResponse(config, finalStep.response),
    });

    // Plain text has no error envelope. Fail the stream before toTextStream
    // can silently filter an SDK error part into a truncated successful answer.
    const checkedStream = result.stream.pipeThrough(new TransformStream({
      transform(part, controller) {
        if (part.type === "error") {
          throw part.error instanceof Error ? part.error : new Error("Model stream failed");
        }
        controller.enqueue(part);
      },
    }));

    return createTextStreamResponse({
      stream: toTextStream({ stream: checkedStream }),
    });
  };
}
