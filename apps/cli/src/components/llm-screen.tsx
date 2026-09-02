import { useRef, useState } from "react";
import { useCompletion } from "@ai-sdk/react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { api } from "../lib/client";
import { NavBar } from "./nav-bar";
import { RouteInput } from "./route-input";

export function LlmScreen() {
  const renderer = useRenderer();
  const [prompt, setPrompt] = useState("");
  const promptRef = useRef("");
  const { completion, complete, isLoading, error } = useCompletion({
    api: api.api.llm.$url().toString(),
  });

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
      <text fg="#7aa2f7">LLM Demo</text>
      <text fg="#888888">prompt:</text>
      <input
        value={prompt}
        onChange={(value) => {
          promptRef.current = value;
          setPrompt(value);
        }}
        onSubmit={() => {
          if (!isLoading) complete(promptRef.current);
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
      <NavBar active="llm" />
      <text fg="#888888">Press q or Ctrl+C to exit.</text>
    </box>
  );
}
