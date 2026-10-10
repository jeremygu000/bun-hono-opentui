import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const env = z.object({
  AI_PROVIDER: z.enum(["deepseek", "openrouter"]).default("openrouter"),
  AI_MODEL: z.string().trim().min(1).optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
}).parse(Bun.env);

const providers = {
  deepseek: {
    baseURL: "https://api.deepseek.com",
    apiKey: env.DEEPSEEK_API_KEY,
    model: "deepseek-flash",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: env.OPENAI_API_KEY,
    model: "nvidia/nemotron-3.5-lightning:free",
  },
};

export const aiConfig = {
  ...providers[env.AI_PROVIDER],
  provider: env.AI_PROVIDER,
  model: env.AI_MODEL ?? providers[env.AI_PROVIDER].model,
};

const provider = createOpenAI({
  baseURL: aiConfig.baseURL,
  apiKey: aiConfig.apiKey,
});

export const aiModel = provider.chat(aiConfig.model);
