import { useKeyboard, useRenderer } from "@opentui/react";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";
import { NavBar } from "../components/nav-bar";

export function AboutRoute() {
  const renderer = useRenderer();

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
      <NavBar active="about" />
      <text fg="#888888">Press q or Ctrl+C to exit.</text>
    </box>
  );
}
