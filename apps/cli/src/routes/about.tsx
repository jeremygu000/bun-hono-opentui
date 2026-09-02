import { useEffect, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";
import { api } from "../lib/client";
import { NavBar } from "../components/nav-bar";
import { RouteInput } from "../components/route-input";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; data: { status: string } }
  | { status: "error"; message: string };

export function AboutRoute() {
  const renderer = useRenderer();
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api.health
      .$get()
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setHealth({ status: "error", message: `HTTP ${res.status}` });
          return;
        }
        const data = await res.json();
        if (!cancelled) setHealth({ status: "ok", data: data as { status: string } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setHealth({
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
      <text fg="#7aa2f7">About</text>
      <text>{JEREMYCODE_NAME} is a small Bun + Hono + OpenTUI monorepo.</text>
      <text fg="#888888">Built on the OpenTUI React reconciler.</text>
      <text fg="#888888">live /health:</text>
      {health.status === "loading" ? (
        <text fg="#888888">checking...</text>
      ) : health.status === "ok" ? (
        <text fg="#9ece6a">{JSON.stringify(health.data)}</text>
      ) : (
        <text fg="#f7768e">{health.message}</text>
      )}
      <RouteInput />
      <NavBar active="about" />
      <text fg="#888888">Press q or Ctrl+C to exit.</text>
    </box>
  );
}
