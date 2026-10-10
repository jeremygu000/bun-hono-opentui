import { getToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";
import { ChatError } from "./chat-error";

type ToolPart = ToolUIPart | DynamicToolUIPart;

const labels: Record<ToolPart["state"], string> = {
  "input-streaming": "receiving input",
  "input-available": "input ready",
  "approval-requested": "awaiting approval",
  "approval-responded": "approval responded",
  "output-available": "completed",
  "output-error": "failed",
  "output-denied": "denied",
};

function formatPayload(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? "";
}

export function ChatTool({ part }: { part: ToolPart }) {
  const label = part.state === "approval-responded"
    ? (part.approval.approved ? "approved" : "approval denied")
    : part.state === "output-available" && part.preliminary
      ? "preliminary output"
      : labels[part.state];

  return (
    <box flexDirection="column" flexShrink={0}>
      <text>Tool: {getToolName(part)} — {label}</text>
      {part.input !== undefined ? <text fg="gray">Input: {formatPayload(part.input)}</text> : null}
      {part.state === "input-streaming" && part.input === undefined && part.rawInput
        ? <text fg="gray">Input: {part.rawInput}</text>
        : null}
      {part.state === "output-available" ? <text>Output: {formatPayload(part.output)}</text> : null}
      {part.state === "output-error" ? <ChatError message={part.errorText} /> : null}
      {part.approval?.reason ? <text fg="gray">{part.approval.reason}</text> : null}
      {part.approval?.requestReason ? <text fg="gray">{part.approval.requestReason}</text> : null}
    </box>
  );
}
