import { useRef } from "react";
import type { TextareaRenderable } from "@opentui/core";

export function PromptTextarea() {
  const ref = useRef<TextareaRenderable | null>(null);

  return (
    <box
      border
      borderColor="#7aa2f7"
      flexDirection="column"
      padding={1}
      width="80%"
    >
      <text fg="#888888">Ask anything. Press Esc to leave the input.</text>
      <textarea
        ref={ref}
        initialValue=""
        placeholder={`Try: "What can ${""}this CLI do?"`}
        width="100%"
        height={6}
        wrapMode="word"
        focused
      />
    </box>
  );
}
