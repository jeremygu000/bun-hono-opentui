import { useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { promptSchema } from "@bun-hono-opentui/shared";
import { api } from "../lib/client";
import { NavBar } from "./nav-bar";
import { RouteInput } from "./route-input";

export function LlmTestScreen() {
  const renderer = useRenderer();
  const [prompt, setPrompt] = useState("");
  const [routeFocused, setRouteFocused] = useState(false);
  const [completion, setCompletion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error>();

  async function submit(input: unknown) {
    const parsed = promptSchema.safeParse({ prompt: input });
    if (!parsed.success) {
      setError(new Error(parsed.error.issues[0]?.message ?? "Invalid prompt"));
      return;
    }
    setCompletion("");
    setError(undefined);
    setIsLoading(true);

    try {
      const response = await api["llm-test"].$post({ json: parsed.data });

      if (!response.ok || !response.body) {
        throw new Error(await response.text());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let result = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
        setCompletion(result);
      }
      result += decoder.decode();
      if (!result.trim()) throw new Error("Model returned no text. Please retry or switch models.");
      setCompletion(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setIsLoading(false);
    }
  }

  useKeyboard((key) => {
    if (key.name === "tab") setRouteFocused((value) => !value);
    if (key.name === "q") renderer.destroy();
  });

  return (
    <box
      alignItems="center"
      flexDirection="column"
      gap={1}
      height="100%"
      justifyContent="center"
      padding={2}
      width="100%"
    >
      <text fg="#7aa2f7">LLM Test</text>
      <text fg="#888888">typed RPC + ReadableStream</text>
      <text fg="#888888">prompt:</text>
      <input
        value={prompt}
        focused={!routeFocused}
        onChange={setPrompt}
        onSubmit={(value) => {
          if (!isLoading) void submit(value);
        }}
        placeholder="Type a prompt and press Enter..."
        width={60}
      />
      <text fg="#888888">response:</text>
      {error ? (
        <text fg="#f7768e">{error.message}</text>
      ) : (
        <text fg={completion ? "#9ece6a" : "#888888"}>
          {completion || (isLoading ? "thinking..." : "(empty)")}
        </text>
      )}
      <RouteInput focused={routeFocused} />
      <NavBar active="llmTest" />
      <text fg="#888888">Tab: switch input | q or Ctrl+C: exit.</text>
    </box>
  );
}
