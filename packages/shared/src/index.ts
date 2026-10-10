import { z } from "zod";

export const JEREMYCODE_NAME = "jeremycode";

export const promptSchema = z.object({
  prompt: z
    .string()
    .min(1, "prompt must not be empty")
    .max(2000, "prompt must be at most 2000 characters"),
});

export type PromptBody = z.infer<typeof promptSchema>;

export const chatBodySchema = z.object({
  // UIMessage parts are extensible, so validate only the boundary shape here.
  messages: z.array(z.unknown()).min(1, "messages must be a non-empty array"),
});

export type ChatBody = z.infer<typeof chatBodySchema>;

export const chatStateSchema = z.object({
  prompt: z.string(),
});

export type ChatState = z.infer<typeof chatStateSchema>;
