import { z } from "zod";

export const promptSchema = z.object({
  prompt: z
    .string()
    .min(1, "prompt must not be empty")
    .max(2000, "prompt must be at most 2000 characters"),
});

export type PromptBody = z.infer<typeof promptSchema>;
