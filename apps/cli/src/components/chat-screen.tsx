import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { chatStateSchema } from "@bun-hono-opentui/shared";
import { chatStrategy } from "../lib/chat-config";
import { createChatTransport } from "../lib/chat-transport";
import { NavBar } from "./nav-bar";

export function ChatScreen() {
  const renderer = useRenderer();
  const location = useLocation();
  const parsed = chatStateSchema.safeParse(location.state);
  const initialPrompt = parsed.success ? parsed.data.prompt : "";
  const [initialMessages] = useState<UIMessage[]>(
    initialPrompt
      ? [{ id: "user-1", role: "user", parts: [{ type: "text", text: initialPrompt }] }]
      : [],
  );
  const transport = useMemo(
    () => createChatTransport(),
    [],
  );

  const { messages, sendMessage, status, error, stop } = useChat({
    id: "chat-demo",
    messages: initialMessages,
    transport,
  });

  const [input, setInput] = useState("");
  const hasSentInitialPrompt = useRef(false);

  useEffect(() => {
    if (!initialPrompt || hasSentInitialPrompt.current) return;
    hasSentInitialPrompt.current = true;
    void sendMessage();
  }, [initialPrompt, sendMessage]);

  useKeyboard((key) => {
    if (key.name === "escape") void stop();
    if (key.name === "q") renderer.destroy();
  });

  return (
    <box
      alignItems="center"
      flexDirection="column"
      gap={1}
      height="100%"
      justifyContent="flex-start"
      padding={2}
      width="100%"
    >
      <text fg="#7aa2f7">Chat</text>
      <text fg="#888888">strategy: {chatStrategy} | POST /chat</text>
      <text fg="#888888">messages: {messages.length} | status: {status}</text>
      <box flexDirection="column" gap={1} width={70}>
        {messages.map((m) => (
          <box key={m.id} flexDirection="column">
            <text fg="#7aa2f7">
              {m.role === "user" ? "you" : m.role === "assistant" ? "ai" : m.role}
            </text>
            {m.parts.map((part, i) =>
              part.type === "text" ? (
                <text key={i} fg={m.role === "user" ? "#c0caf5" : "#9ece6a"}>
                  {part.text ||
                    (status === "streaming" && m.role === "assistant" ? "..." : "")}
                </text>
              ) : null,
            )}
          </box>
        ))}
        {error ? <text fg="#f7768e">error: {error.message}</text> : null}
      </box>
      <box flexDirection="row" gap={1} width={70}>
        <input
          focused
          value={input}
          onChange={setInput}
          onSubmit={() => {
            const text = input.trim();
            if (!text || status === "submitted" || status === "streaming") return;
            setInput("");
            sendMessage({ text });
          }}
          placeholder="Type a message and press Enter..."
          width={56}
        />
        <text
          fg={status === "submitted" || status === "streaming" ? "#e0af68" : "#888888"}
        >
          {status === "submitted" || status === "streaming" ? "stop" : "send"}
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <text
          fg={status === "submitted" || status === "streaming" ? "#7aa2f7" : "#444444"}
          attributes={status === "submitted" || status === "streaming" ? 1 : 0}
          onMouseDown={() => {
            if (status === "submitted" || status === "streaming") stop();
          }}
        >
          [ press Esc to stop ]
        </text>
      </box>
      <NavBar active="chat" />
      <text fg="#888888">Press q or Ctrl+C to exit.</text>
    </box>
  );
}
