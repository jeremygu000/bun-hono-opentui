import { useKeyboard, useRenderer } from "@opentui/react";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";
import { NavBar } from "../components/nav-bar";

export function SettingsRoute() {
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
      <text fg="#7aa2f7">Settings</text>
      <text>No settings yet. This is a placeholder for {JEREMYCODE_NAME}.</text>
      <NavBar active="settings" />
      <text fg="#888888">Press q or Ctrl+C to exit.</text>
    </box>
  );
}
