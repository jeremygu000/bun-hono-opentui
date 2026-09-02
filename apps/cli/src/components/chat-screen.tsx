import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { chatStateSchema } from "@bun-hono-opentui/shared";
import { api } from "../lib/client";

export function ChatScreen() {
  const location = useLocation();
  const parsed = chatStateSchema.safeParse(location.state);
  const prompt = parsed.success ? parsed.data.prompt : "";

  const [reply, setReply] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (!prompt) return;
    const controller = new AbortController();

    async function stream() {
      setReply("");
      setError(undefined);
      setIsLoading(true);

      try {
        const response = await fetch(api["llm-hybrid"].$url(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(await response.text());
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let result = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          result += decoder.decode(value, { stream: true });
          setReply(result);
        }
      } catch (cause) {
        if ((cause as { name?: string })?.name === "AbortError") return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        setIsLoading(false);
      }
    }

    void stream();
    return () => controller.abort();
  }, [prompt]);

  return (
    <box alignItems="center" flexDirection="column" gap={1} padding={2}>
      <text fg="#7aa2f7">Chat Streaming</text>
      <text fg="#888888">your prompt was:</text>
      <text fg="#9ece6a">{prompt || "(empty)"}</text>
      <text fg="#888888">response:</text>
      {error ? (
        <text fg="#f7768e">{error.message}</text>
      ) : (
        <text fg={reply ? "#9ece6a" : "#888888"}>
          {reply || (isLoading ? "thinking..." : "(empty)")}
        </text>
      )}
    </box>
  );
}
