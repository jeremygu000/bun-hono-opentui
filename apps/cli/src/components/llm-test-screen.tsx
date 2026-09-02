import { useRef, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { api } from "../lib/client";
import { NavBar } from "./nav-bar";
import { RouteInput } from "./route-input";

export function LlmTestScreen() {
  const renderer = useRenderer();
  const [prompt, setPrompt] = useState("");
  const promptRef = useRef("");
  const [completion, setCompletion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error>();

  async function submit() {
    setCompletion("");
    setError(undefined);
    setIsLoading(true);

    try {
      const response = await fetch(api["llm-test"].$url(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptRef.current }),
      });

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
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setIsLoading(false);
    }
  }

  useKeyboard((key) => {
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
      <text fg="#888888">manual fetch + ReadableStream</text>
      <text fg="#888888">prompt:</text>
      <input
        value={prompt}
        onChange={(value) => {
          promptRef.current = value;
          setPrompt(value);
        }}
        onSubmit={() => {
          if (!isLoading) void submit();
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
      <RouteInput />
      <NavBar active="llmTest" />
      <text fg="#888888">Press q or Ctrl+C to exit.</text>
    </box>
  );
}
