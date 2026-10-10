import { z } from "zod";

export const JEREMYCODE_NAME = "jeremycode";

export const promptSchema = z.object({
  prompt: z
    .string()
    .min(1, "prompt must not be empty")
    .max(2000, "prompt must be at most 2000 characters"),
});

export type PromptBody = z.infer<typeof promptSchema>;

export const chatStrategySchema = z.enum(["sdk-ui", "direct-text", "sdk-text"]);

export type ChatStrategy = z.infer<typeof chatStrategySchema>;

// SDK validation on the server checks the nested UIMessage shape.
// Exactly one input format is accepted; transport metadata is ignored.
export const chatBodySchema = z.union([
  promptSchema.extend({
    strategy: chatStrategySchema.default("sdk-ui"),
    messages: z.never().optional(),
  }),
  z.object({
    strategy: chatStrategySchema.default("sdk-ui"),
    messages: z.array(z.unknown()).min(1, "messages must be a non-empty array"),
    prompt: z.never().optional(),
  }),
]);

export type ChatBody = z.infer<typeof chatBodySchema>;

export const chatStateSchema = z.object({
  prompt: z.string(),
});

export type ChatState = z.infer<typeof chatStateSchema>;
