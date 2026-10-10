import type { ReasoningUIPart } from "ai";

export function ChatReasoning({ part }: { part: ReasoningUIPart }) {
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg="gray">Reasoning{part.state === "streaming" ? " (streaming)" : ""}</text>
      {part.text ? <text fg="gray">{part.text}</text> : null}
    </box>
  );
}
