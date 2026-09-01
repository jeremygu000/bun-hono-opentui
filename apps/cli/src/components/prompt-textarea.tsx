import { useRef } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";

export function PromptTextarea() {
  const ref = useRef<TextareaRenderable | null>(null);

  return (
    <box
      border
      borderColor="#7aa2f7"
      paddingX={1}
      paddingY={0}
      title={`prompt | ask ${JEREMYCODE_NAME} anything`}
      titleAlignment="left"
      titleColor="#7aa2f7"
      width="80%"
    >
      <textarea
        ref={ref}
        focused
        height={6}
        initialValue=""
        placeholder='Try: "What can this CLI do?"'
        width="100%"
        wrapMode="word"
      />
    </box>
  );
}
