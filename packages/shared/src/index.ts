import { z } from "zod";

export const JEREMYCODE_NAME = "jeremycode";

export const promptSchema = z.object({
  prompt: z
    .string()
    .min(1, "prompt must not be empty")
    .max(2000, "prompt must be at most 2000 characters"),
});

export type PromptBody = z.infer<typeof promptSchema>;

export const chatStateSchema = z.object({
  prompt: z.string(),
});

export type ChatState = z.infer<typeof chatStateSchema>;
