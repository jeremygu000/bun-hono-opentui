import { useState } from "react";
import { useCompletion } from "@ai-sdk/react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { promptSchema } from "@bun-hono-opentui/shared";
import { api } from "../lib/client";
import { chatStrategy, completionStreamProtocol } from "../lib/chat-config";
import { chatFetch } from "../lib/chat-transport";
import { NavBar } from "./nav-bar";
import { RouteInput } from "./route-input";

export function PromptScreen({ title, active }: {
  title: string;
  active: "llm";
}) {
  const renderer = useRenderer();
  const [prompt, setPrompt] = useState("");
  const [routeFocused, setRouteFocused] = useState(false);
  const [validationError, setValidationError] = useState<string>();
  const { completion, complete, isLoading, error, stop } = useCompletion({
    api: api.chat.$url().toString(),
    body: { strategy: chatStrategy },
    streamProtocol: completionStreamProtocol,
    fetch: chatFetch,
  });

  useKeyboard((key) => {
    if (key.name === "tab") setRouteFocused((value) => !value);
    if (key.name === "escape") stop();
    if (key.name === "q") renderer.destroy();
  });

  return (
    <box alignItems="center" flexDirection="column" gap={1} height="100%"
      justifyContent="center" padding={2} width="100%">
      <text fg="#7aa2f7">{title}</text>
      <text fg="#888888">strategy: {chatStrategy} | POST /chat</text>
      <text fg="#888888">prompt:</text>
      <input value={prompt} focused={!routeFocused} onChange={setPrompt}
        onSubmit={(value) => {
          if (isLoading) return;
          const parsed = promptSchema.safeParse({ prompt: value });
          if (!parsed.success) {
            setValidationError(parsed.error.issues[0]?.message ?? "Invalid prompt");
            return;
          }
          setValidationError(undefined);
          void complete(parsed.data.prompt);
        }}
        placeholder="Type a prompt and press Enter..." width={60} />
      <text fg="#888888">response:</text>
      {validationError || error ? (
        <text fg="#f7768e">{validationError ?? error?.message}</text>
      ) : (
        <text fg={completion ? "#9ece6a" : "#888888"}>
          {completion || (isLoading ? "thinking..." : "(empty)")}
        </text>
      )}
      <RouteInput focused={routeFocused} />
      <NavBar active={active} />
      <text fg="#888888">Tab: switch input | Esc: stop | q or Ctrl+C: exit.</text>
    </box>
  );
}
