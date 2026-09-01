import { useKeyboard, useRenderer } from "@opentui/react";
import { NavBar } from "../components/nav-bar";

export function NotFoundRoute() {
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
      <text fg="#f7768e">404</text>
      <text>That screen does not exist.</text>
      <NavBar active="home" />
      <text fg="#888888">Press q or Ctrl+C to exit.</text>
    </box>
  );
}
