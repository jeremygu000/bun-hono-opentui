import { createUIMessageStreamResponse, streamText, toUIMessageStream } from "ai";
import { logModelResponse, prepareSdkInput } from "./sdk-support";
import type { ChatHandler, SdkStrategyDependencies } from "./types";

// AI SDK invocation -> structured UIMessage SSE, including lifecycle/error events.
// Unlike sdk-text, this preserves the UI protocol rather than just answer text.
export function createSdkUiStrategy({ model, config }: SdkStrategyDependencies): ChatHandler {
  return async (input, signal) => {
    const modelInput = await prepareSdkInput(input);
    const result = streamText({
      model,
      ...modelInput,
      abortSignal: signal,
      onEnd: ({ finalStep }) => logModelResponse(config, finalStep.response),
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  };
}
