import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { chatStateSchema } from "@bun-hono-opentui/shared";
import { chatStrategy } from "../lib/chat-config";
import { createChatTransport } from "../lib/chat-transport";
import { NavBar } from "../components/nav-bar";
import { ChatError } from "../components/chat-error";
import { ChatMessage } from "../components/chat-message";
import { ChatShell } from "../components/chat-shell";
import { ChatTextarea } from "../components/chat-textarea";

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

  const busy = status === "submitted" || status === "streaming";
  const hasSentInitialPrompt = useRef(false);

  useEffect(() => {
    if (!initialPrompt || hasSentInitialPrompt.current) return;
    hasSentInitialPrompt.current = true;
    void sendMessage();
  }, [initialPrompt, sendMessage]);

  useKeyboard((key) => {
    if (key.name === "escape") void stop();
    if (key.name === "c" && key.ctrl) renderer.destroy();
  });

  return (
    <ChatShell
      header={<text>Chat | {chatStrategy} | {status}</text>}
      composer={<ChatTextarea busy={busy} onSubmit={(text) => { void sendMessage({ text }); }} />}
      footer={(
        <>
          <text fg="gray">Enter send | Shift+Enter / Ctrl+Enter newline | Esc stop | Ctrl+C exit</text>
          <NavBar active="chat" />
        </>
      )}
    >
      {messages.map((message) => <ChatMessage key={message.id} message={message} />)}
      {busy ? <text fg="gray">{status === "submitted" ? "Waiting for response..." : "Responding..."}</text> : null}
      {error ? <ChatError message={error.message} /> : null}
    </ChatShell>
  );
}
