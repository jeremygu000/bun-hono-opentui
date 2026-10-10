import { useRef, useState } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { promptSchema } from "@bun-hono-opentui/shared";
import { ChatError } from "./chat-error";

interface ChatTextareaProps {
  busy?: boolean;
  onSubmit: (text: string) => void;
}

export function ChatTextarea({ busy = false, onSubmit }: ChatTextareaProps) {
  const textarea = useRef<TextareaRenderable>(null);
  const [error, setError] = useState<string>();

  function submit() {
    if (busy) return;
    const text = textarea.current?.plainText.trim() ?? "";
    if (!text) return;
    const parsed = promptSchema.safeParse({ prompt: text });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid message");
      return;
    }
    onSubmit(parsed.data.prompt);
    textarea.current?.setText("");
    setError(undefined);
  }

  return (
    <box flexDirection="column" flexShrink={0} width="100%">
      {error ? <ChatError message={error} /> : null}
      <textarea
        id="chat-textarea"
        ref={textarea}
        focused
        height={3}
        flexShrink={0}
        width="100%"
        wrapMode="word"
        backgroundColor="transparent"
        focusedBackgroundColor="transparent"
        placeholder={busy ? "Waiting for response..." : "Type a message..."}
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "return", shift: true, action: "newline" },
          { name: "return", ctrl: true, action: "newline" },
        ]}
        onSubmit={submit}
      />
    </box>
  );
}
