import { useLocation } from "react-router";
import { chatStateSchema } from "@bun-hono-opentui/shared";

export function ChatScreen() {
  const location = useLocation();
  const parsed = chatStateSchema.safeParse(location.state);
  const prompt = parsed.success ? parsed.data.prompt : "";

  return (
    <box alignItems="center" flexDirection="column" gap={1} padding={2}>
      <text fg="#7aa2f7">Chat Streaming</text>
      <text fg="#888888">your prompt was:</text>
      <text fg="#9ece6a">{prompt || "(empty)"}</text>
    </box>
  );
}
