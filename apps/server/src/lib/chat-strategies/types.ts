import type { LanguageModel } from "ai";
import type { ChatInput } from "../chat-input";

export type ChatConfig = {
  provider: string;
  baseURL: string;
  apiKey: string | undefined;
  model: string;
};

export type ChatHandler = (input: ChatInput, signal: AbortSignal) => Promise<Response>;

export type SdkStrategyDependencies = {
  model: LanguageModel;
  config: ChatConfig;
};

export type DirectStrategyDependencies = {
  config: ChatConfig;
  fetchUpstream?: typeof fetch;
};

export type ChatStrategyDependencies = SdkStrategyDependencies & DirectStrategyDependencies;
