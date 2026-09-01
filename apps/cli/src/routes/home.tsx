import { useKeyboard, useRenderer } from "@opentui/react";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";
import { LogoArt } from "../components/logo-art";
import { PromptTextarea } from "../components/prompt-textarea";
import { RouteInput } from "../components/route-input";
import { NavBar } from "../components/nav-bar";

export function HomeRoute() {
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
      <LogoArt />
      <text fg="#888888">Welcome to {JEREMYCODE_NAME}.</text>
      <RouteInput />
      <PromptTextarea />
      <NavBar active="home" />
      <text fg="#888888">Press q or Ctrl+C to exit.</text>
    </box>
  );
}
