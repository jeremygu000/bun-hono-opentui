import { useEffect, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { api } from "../lib/client";
import { NavBar } from "../components/nav-bar";
import { RouteInput } from "../components/route-input";

type LlmState =
  | { status: "loading" }
  | { status: "ok"; text: string }
  | { status: "error"; message: string };

export function LlmScreen() {
  const renderer = useRenderer();
  const [llm, setLlm] = useState<LlmState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const prompt = "Say hello in one short sentence.";
    api.api.llm
      .$get({ q: prompt })
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setLlm({ status: "error", message: `HTTP ${res.status}` });
          return;
        }
        const data = await res.json();
        if (!cancelled) setLlm({ status: "ok", text: data.text ?? "" });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLlm({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useKeyboard((key) => {
    if (key.name === "q") renderer.destroy();
  });

  return (
    <box
      alignItems="center"
      flexDirection="column"
      gap={1}
      height="100%"
      justifyContent="center"
      padding={2}
      width="100%"
    >
      <text fg="#7aa2f7">LLM Demo</text>
      {llm.status === "loading" ? (
        <text fg="#888888">thinking...</text>
      ) : llm.status === "ok" ? (
        <text fg="#9ece6a">{llm.text}</text>
      ) : (
        <text fg="#f7768e">{llm.message}</text>
      )}
      <RouteInput />
      <NavBar active="llm" />
      <text fg="#888888">Press q or Ctrl+C to exit.</text>
    </box>
  );
}
