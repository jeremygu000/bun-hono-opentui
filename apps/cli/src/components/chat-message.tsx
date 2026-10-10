import { isToolUIPart, type UIMessage } from "ai";
import { ChatReasoning } from "./chat-reasoning";
import { ChatTool } from "./chat-tool";

export function ChatMessage({ message }: { message: UIMessage }) {
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg="gray">{message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System"}</text>
      {message.parts.map((part, index) => {
        if (isToolUIPart(part)) return <ChatTool key={part.toolCallId} part={part} />;
        switch (part.type) {
          case "text":
            return <text key={index}>{part.text || (part.state === "streaming" ? "..." : "")}</text>;
          case "reasoning":
            return <ChatReasoning key={index} part={part} />;
          case "step-start":
            return null;
          default:
            return <text key={index} fg="gray">[{part.type} content]</text>;
        }
      })}
    </box>
  );
}
