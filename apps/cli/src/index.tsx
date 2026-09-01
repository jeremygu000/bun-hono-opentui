import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";
import { LogoArt } from "./LogoArt";
import { PromptTextarea } from "./PromptTextarea";

function HomeScreen() {
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
      <PromptTextarea />
      <text fg="#888888">Press q or Ctrl+C to exit.</text>
    </box>
  );
}

const renderer = await createCliRenderer({ exitOnCtrlC: true });
createRoot(renderer).render(<HomeScreen />);
